#!/bin/bash
# ==============================================================================
# Script de Déploiement Automatisé pour Laboratoire Google Skills Boost
# Service cible : "vless-manager" (us-central1)
# Règle absolue : Protéger le service existant "montre" sans modification
# Optimisé pour Google Cloud Shell depuis un téléphone Android
# ==============================================================================

set -e

REGION="us-central1"
SERVICE_NAME="vless-manager"
EXISTING_SERVICE="montre"

echo "================================================================="
echo "🚀 DÉPLOIEMENT VLESS MANAGER — LABORATOIRE GOOGLE SKILLS BOOST"
echo "================================================================="

# 1. Détection automatique du projet temporaire du laboratoire
PROJECT_ID=$(gcloud config get-value project 2>/dev/null || echo "")

if [ -z "$PROJECT_ID" ]; then
  echo "❌ Aucun projet Google Cloud actif détecté."
  echo "Veuillez vous assurer que vous êtes connecté à Cloud Shell dans le laboratoire actif."
  exit 1
fi

echo "✔ Projet actif détecté : $PROJECT_ID"
echo "✔ Région de déploiement : $REGION"
echo "✔ Nouveau service : $SERVICE_NAME"
echo ""

# 2. Protection stricte du service existant
echo "🔒 Vérification de sécurité du service existant '$EXISTING_SERVICE'..."
if gcloud run services describe "$EXISTING_SERVICE" --region "$REGION" >/dev/null 2>&1; then
  echo "✔ Service '$EXISTING_SERVICE' détecté en ligne dans la région $REGION."
  echo "✔ GARANTIE : Ce service ne sera NI modifié, NI redéployé, NI supprimé."
else
  echo "ℹ Le service '$EXISTING_SERVICE' n'a pas été trouvé dans ce projet ($PROJECT_ID)."
  echo "  (Il est hébergé sur une autre instance ou un autre projet Cloud Run)."
fi
echo ""

# 3. Vérification des quotas Cloud Run dans le laboratoire Skills Boost
echo "🔍 Vérification des quotas Cloud Run du laboratoire..."
SERVICE_COUNT=$(gcloud run services list --region "$REGION" --format="value(SERVICE)" 2>/dev/null | wc -l || echo 0)
echo "Services Cloud Run actuellement actifs dans la région $REGION : $SERVICE_COUNT"

# 4. Activation conditionnelle des API requises (si permissions accordées par le lab)
echo "🔧 Vérification et activation des APIs nécessaires..."
for api in run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com; do
  echo "  - Vérification de $api..."
  gcloud services enable "$api" 2>/dev/null || echo "    (Note : L'activation de $api a été ignorée ou est déjà gérée par le lab)"
done
echo ""

# 5. Déploiement direct depuis le code source
echo "📦 Lancement de la construction et du déploiement de '$SERVICE_NAME'..."
echo "Cette étape prend environ 2 à 3 minutes..."

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,PORT=8080,TARGET_HOST=montre-635195440423.us-central1.run.app,TARGET_PORT=443,TARGET_WS_PATH=/Telegram/@AM2_D3/@AHMAD3214,ADMIN_PASSWORD=Admin@Vless2026" \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3

echo ""
echo "================================================================="
echo "🎉 DÉPLOIEMENT TERMINÉ AVEC SUCCÈS !"
echo "================================================================="

URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format="value(status.url)")
echo "🌐 URL publique de votre panneau VLESS MANAGER :"
echo "$URL"
echo ""
echo "🔑 Identifiants administrateur par défaut :"
echo "   Mot de passe : Admin@Vless2026"
echo ""
echo "🔒 Service existant 'montre' : INTACT ET STRICTEMENT INCHANGÉ."
echo "================================================================="
