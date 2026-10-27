//! Icone dans la zone de notification de Windows (barre des taches).
//!
//! L'appli surveille en fond : fermer la fenetre la cache au lieu de quitter,
//! et l'icone garde l'etat global sous les yeux (pastille verte, orange ou
//! rouge sur le logo). Clic : rouvrir. Menu : rouvrir, verifier, quitter.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

const ID_ICONE: &str = "principale";
/// Evenement envoye au front quand « Verifier maintenant » est choisi.
pub const EVENEMENT_VERIFIER: &str = "barre:verifier";

const LOGO: &[u8] = include_bytes!("../icons/32x32.png");

/// Couleur de la pastille d'etat (memes teintes que l'interface).
fn couleur(etat: &str) -> Option<[u8; 3]> {
    match etat {
        "ok" => Some([0x22, 0xc5, 0x5e]),
        "alerte" => Some([0xf5, 0x9e, 0x0b]),
        "ko" => Some([0xef, 0x44, 0x44]),
        _ => None,
    }
}

/// Le logo de l'appli, avec une pastille de couleur en bas a droite. La forme
/// ne change pas d'un etat a l'autre : l'infobulle dit l'etat en toutes lettres.
pub fn icone(etat: &str) -> Image<'static> {
    let logo = Image::from_bytes(LOGO).expect("icons/32x32.png lisible");
    let (largeur, hauteur) = (logo.width(), logo.height());
    let mut rgba = logo.rgba().to_vec();
    if let Some([r, g, b]) = couleur(etat) {
        let rayon = largeur as f32 * 0.28;
        let (cx, cy) = (largeur as f32 - rayon - 0.5, hauteur as f32 - rayon - 0.5);
        for y in 0..hauteur {
            for x in 0..largeur {
                let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
                let i = ((y * largeur + x) * 4) as usize;
                if d <= rayon - 1.5 {
                    rgba[i..i + 4].copy_from_slice(&[r, g, b, 255]);
                } else if d <= rayon {
                    // Liseret sombre : la pastille se detache sur un logo clair comme fonce
                    rgba[i..i + 4].copy_from_slice(&[0x0a, 0x0d, 0x14, 255]);
                }
            }
        }
    }
    Image::new_owned(rgba, largeur, hauteur)
}

fn montrer(app: &AppHandle) {
    if let Some(fenetre) = app.get_webview_window("main").or_else(|| app.webview_windows().into_values().next()) {
        let _ = fenetre.unminimize();
        let _ = fenetre.show();
        let _ = fenetre.set_focus();
    }
}

/// Cree l'icone et son menu. Appele une fois, au demarrage.
pub fn installer(app: &AppHandle) -> tauri::Result<()> {
    let ouvrir = MenuItem::with_id(app, "ouvrir", "Ouvrir SiteDashboard", true, None::<&str>)?;
    let verifier = MenuItem::with_id(app, "verifier", "Vérifier maintenant", true, None::<&str>)?;
    let separateur = PredefinedMenuItem::separator(app)?;
    let quitter = MenuItem::with_id(app, "quitter", "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&ouvrir, &verifier, &separateur, &quitter])?;

    TrayIconBuilder::with_id(ID_ICONE)
        .icon(icone(""))
        .tooltip("SiteDashboard")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, evenement| match evenement.id.as_ref() {
            "ouvrir" => montrer(app),
            "verifier" => {
                let _ = app.emit(EVENEMENT_VERIFIER, ());
            }
            "quitter" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|icone, evenement| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = evenement
            {
                montrer(icone.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Met a jour la pastille et l'infobulle : `etat` vaut ok, alerte ou ko.
#[tauri::command]
pub fn etat_barre(app: AppHandle, etat: String, infobulle: String) -> Result<(), String> {
    let Some(icone_barre) = app.tray_by_id(ID_ICONE) else {
        return Ok(());
    };
    // Windows tronque les infobulles a 127 caracteres
    let texte: String = infobulle.chars().take(120).collect();
    icone_barre.set_icon(Some(icone(&etat))).map_err(|e| e.to_string())?;
    icone_barre.set_tooltip(Some(texte)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_pastille_change_de_couleur_selon_l_etat() {
        let neutre = icone("");
        let ko = icone("ko");
        assert_eq!((ko.width(), ko.height()), (neutre.width(), neutre.height()));
        // Le coin bas-droit passe au rouge, le coin haut-gauche ne bouge pas
        let w = ko.width() as usize;
        let h = ko.height() as usize;
        let centre = ((h - 1 - (h as f32 * 0.28) as usize) * w + (w - 1 - (w as f32 * 0.28) as usize)) * 4;
        assert_eq!(&ko.rgba()[centre..centre + 3], &[0xef, 0x44, 0x44]);
        assert_eq!(&ko.rgba()[0..4], &neutre.rgba()[0..4]);
    }
}
