package middleware

import (
	"net"
	"net/http"
	"sync"
	"time"
	"training-app/backend/controllers"
)

// Authentication limits use the peer address, never an untrusted forwarded
// header. Deployments should enforce an additional edge limit per client IP.
func RateLimit(limit int, window time.Duration) func(http.Handler) http.Handler {
	type bucket struct {
		count  int
		starts time.Time
	}
	var mu sync.Mutex
	buckets := map[string]bucket{}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			peer, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				peer = r.RemoteAddr
			}
			if id := UserID(r.Context()); id != "" {
				peer = "account:" + id
			}
			mu.Lock()
			now := time.Now()
			current := buckets[peer]
			if now.Sub(current.starts) >= window {
				current = bucket{starts: now}
			}
			current.count++
			buckets[peer] = current
			if len(buckets) > 10000 {
				for key, v := range buckets {
					if now.Sub(v.starts) >= window {
						delete(buckets, key)
					}
				}
			}
			limited := current.count > limit
			mu.Unlock()
			if limited {
				w.Header().Set("Retry-After", "60")
				controllers.WriteError(w, 429, "too many sign-in attempts; wait a minute and try again")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
