package domain

import (
	"bytes"
	"encoding/json"
	"errors"
	"time"
)

type HealthEnergyDay struct {
	Date            string  `json:"date"`
	RestingCalories float64 `json:"restingCalories"`
	ActiveCalories  float64 `json:"activeCalories"`
	CoverageHours   float64 `json:"coverageHours"`
	DayHours        float64 `json:"dayHours"`
}

func (d *HealthEnergyDay) UnmarshalJSON(raw []byte) error {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return errors.New("invalid Apple Health day")
	}
	for _, key := range []string{"date", "restingCalories", "activeCalories", "coverageHours", "dayHours"} {
		v, ok := fields[key]
		if !ok || bytes.Equal(bytes.TrimSpace(v), []byte("null")) {
			return errors.New("Apple Health days need explicit resting and active energy and time coverage")
		}
	}
	type plain HealthEnergyDay
	var value plain
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return err
	}
	*d = HealthEnergyDay(value)
	return nil
}

type HealthEnergy struct {
	Source   string            `json:"source"`
	SyncedAt string            `json:"syncedAt"`
	Timezone string            `json:"timezone"`
	Sources  []string          `json:"sources"`
	Days     []HealthEnergyDay `json:"days"`
}

func ValidateHealthEnergy(h HealthEnergy) error {
	if h.Source != "apple-health" || len(h.Sources) < 1 || len(h.Sources) > 30 || len(h.Days) < 7 || len(h.Days) > 14 {
		return errors.New("at least seven complete Apple Health energy days and their sources are needed")
	}
	synced, err := time.Parse(time.RFC3339Nano, h.SyncedAt)
	if err != nil {
		return errors.New("invalid Apple Health sync time")
	}
	zone, err := time.LoadLocation(h.Timezone)
	if err != nil {
		return errors.New("invalid Apple Health timezone")
	}
	for _, source := range h.Sources {
		if err := Text(source, "health source", 150, false); err != nil {
			return err
		}
	}
	dates := map[string]bool{}
	var first, last time.Time
	for _, d := range h.Days {
		if err := Date(d.Date); err != nil {
			return err
		}
		date, _ := time.Parse("2006-01-02", d.Date)
		if dates[d.Date] || d.Date >= synced.In(zone).Format("2006-01-02") {
			return errors.New("Apple Health days must be unique and exclude the current incomplete day")
		}
		dates[d.Date] = true
		if first.IsZero() || date.Before(first) {
			first = date
		}
		if last.IsZero() || date.After(last) {
			last = date
		}
		for _, f := range []struct {
			value    float64
			name     string
			min, max float64
		}{{d.RestingCalories, "resting energy", 300, 5000}, {d.ActiveCalories, "active energy", 0, 8000}, {d.DayHours, "health day length", 23, 25}, {d.CoverageHours, "resting energy coverage", d.DayHours * .9, d.DayHours + .01}} {
			if err := Number(f.value, f.name, f.min, f.max); err != nil {
				return err
			}
		}
	}
	if last.Sub(first) > 13*24*time.Hour {
		return errors.New("Apple Health days must come from one fourteen-day window")
	}
	return nil
}
func HealthEnergyMean(h HealthEnergy) (resting, maintenance float64) {
	for _, d := range h.Days {
		resting += d.RestingCalories
		maintenance += d.RestingCalories + d.ActiveCalories
	}
	return resting / float64(len(h.Days)), maintenance / float64(len(h.Days))
}
func ValidateRecentHealthEnergy(h HealthEnergy, now time.Time) error {
	if err := ValidateHealthEnergy(h); err != nil {
		return err
	}
	synced, _ := time.Parse(time.RFC3339Nano, h.SyncedAt)
	if synced.After(now.Add(5*time.Minute)) || now.Sub(synced) > 24*time.Hour {
		return errors.New("sync Apple Health again to use a current energy estimate")
	}
	zone, _ := time.LoadLocation(h.Timezone)
	latest := ""
	for _, d := range h.Days {
		if d.Date > latest {
			latest = d.Date
		}
	}
	if latest < now.In(zone).AddDate(0, 0, -3).Format("2006-01-02") {
		return errors.New("Apple Health energy history is not recent; use the equation estimate")
	}
	return nil
}
