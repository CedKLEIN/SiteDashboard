//! Etat des notifications dans Windows. Quand l'interrupteur general
//! (Parametres > Systeme > Notifications) est coupe, Windows jette sans rien
//! dire les notifications de toutes les applis : SiteDashboard doit le savoir
//! pour le dire, sinon une alerte importante se perd en silence.

/// `ToastEnabled` lu dans la sortie de `reg query` : 0x0 coupe, absent = actif.
fn toasts_actifs(sortie: &str) -> bool {
    sortie
        .lines()
        .find(|l| l.trim_start().starts_with("ToastEnabled"))
        .and_then(|l| l.split_whitespace().last())
        .map_or(true, |valeur| valeur != "0x0")
}

/// true si Windows affiche les notifications, false si elles sont coupees
/// pour toutes les applis. Hors Windows : toujours true.
#[tauri::command]
pub fn notifications_windows() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let sortie = std::process::Command::new("reg")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\PushNotifications",
                "/v",
                "ToastEnabled",
            ])
            .creation_flags(crate::mise_a_jour::SANS_FENETRE)
            .output();
        // Cle absente (code d'erreur) : reglage par defaut, notifications actives
        return sortie.map_or(true, |s| toasts_actifs(&String::from_utf8_lossy(&s.stdout)));
    }
    #[allow(unreachable_code)]
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lit_l_interrupteur_general() {
        let coupe = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications\r\n    ToastEnabled    REG_DWORD    0x0\r\n\r\n";
        assert!(!toasts_actifs(coupe));
        assert!(toasts_actifs(&coupe.replace("0x0", "0x1")));
        assert!(toasts_actifs(""));
    }
}
