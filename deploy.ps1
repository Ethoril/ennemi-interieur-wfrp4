# Script de déploiement - commit et push vers GitHub Pages
param(
    [string]$Message = "Mise à jour du site"
)

Write-Host "⚔️  Déploiement du site Ennemi Intérieur..." -ForegroundColor Yellow
Write-Host ""

# Ajouter tous les changements
git add -A

# Vérifier s'il y a des changements
$status = git status --porcelain
if (-not $status) {
    Write-Host "✓ Aucun changement à déployer." -ForegroundColor Green
    exit 0
}

# Afficher les changements
Write-Host "Changements détectés :" -ForegroundColor Cyan
git status --short
Write-Host ""

# Commit et push
git commit -m $Message
git push origin master

Write-Host ""
Write-Host "✓ Déploiement lancé ! Le site sera mis à jour dans ~1 minute." -ForegroundColor Green
Write-Host "🌐 https://ethoril.github.io/ennemi-interieur-wfrp4/" -ForegroundColor Cyan
