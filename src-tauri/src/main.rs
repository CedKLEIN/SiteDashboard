// Empeche l'ouverture d'une console supplementaire sous Windows en release. NE PAS RETIRER.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    site_dashboard_lib::run()
}
