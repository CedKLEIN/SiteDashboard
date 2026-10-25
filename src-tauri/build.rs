use std::process::Command;

fn main() {
    // Le commit compile, grave dans l'appli : le bouton « Mettre a jour » le
    // compare au dernier commit du depot pour savoir s'il y a du nouveau.
    let commit = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir("..")
        .output()
        .ok()
        .filter(|sortie| sortie.status.success())
        .map(|sortie| String::from_utf8_lossy(&sortie.stdout).trim().to_string())
        .unwrap_or_default();
    println!("cargo:rustc-env=SITEDASHBOARD_COMMIT={commit}");
    // Recompiler quand le depot change de commit, pas seulement quand le code Rust change
    for chemin in ["../.git/HEAD", "../.git/refs/heads", "../.git/packed-refs"] {
        println!("cargo:rerun-if-changed={chemin}");
    }

    tauri_build::build()
}
