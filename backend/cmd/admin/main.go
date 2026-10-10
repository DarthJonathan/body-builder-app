// admin grants or removes the administrator role for an existing, explicitly
// named account. It never creates passwords or promotes public signups.
package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"training-app/backend/config"
	"training-app/backend/dao"
	"training-app/backend/database"
)

func main() {
	email := flag.String("email", "", "existing account email")
	role := flag.String("role", "admin", "admin or user")
	flag.Parse()
	if strings.TrimSpace(*email) == "" || (*role != "admin" && *role != "user") {
		fmt.Fprintln(os.Stderr, "usage: admin -email existing@example.com [-role admin|user]")
		os.Exit(2)
	}
	cfg, err := config.Load()
	if err != nil {
		fail(err)
	}
	db, err := database.Open(cfg)
	if err != nil {
		fail(err)
	}
	pool, err := db.DB()
	if err != nil {
		fail(err)
	}
	defer pool.Close()
	result := db.Model(&dao.User{}).Where("email = ?", strings.ToLower(strings.TrimSpace(*email))).Update("role", *role)
	if result.Error != nil {
		fail(result.Error)
	}
	if result.RowsAffected != 1 {
		fail(fmt.Errorf("no existing account matches the specified email"))
	}
	fmt.Println("Updated the selected account role to", *role)
}
func fail(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
