# VLESS MANAGER — Plateforme de Gestion Complète sur Google Cloud Run

> **Version :** 2.0.0 (Production)  
> **Service Cloud Run :** `vless-manager`  
> **Région :** `us-central1`  
> **Serveur Hôte Protégé :** `https://montre-635195440423.us-central1.run.app`  

---

## 1. Règle Absolue de Sécurité : Protection du Service Existant

Le service existant `montre` reste **STRICTEMENT INCHANGÉ** :
- Aucun redéploiement, aucune modification de code ou de variables d'environnement.
- Les requêtes du panneau vers `montre` sont limitées à des sondes de disponibilité TLS WebSocket non-destructives.
- Toutes les données (comptes, UUIDs, quotas, expirations, journaux) sont stockées dans le nouveau projet `vless-manager`.

---

## 2. Déploiement depuis un Téléphone Android dans Google Skills Boost

Le laboratoire Google Skills Boost fournit un projet temporaire avec un compte étudiant éphémère. Voici la procédure ultra-rapide optimisée pour mobile :

### Étape 1 : Ouvrir Google Cloud Shell sur votre Téléphone
1. Dans votre navigateur Android (Chrome), accédez à la console du laboratoire actif : [console.cloud.google.com](https://console.cloud.google.com).
2. Touchez l'icône **Cloud Shell** (icône `>_` en haut à droite).
3. Basculez votre navigateur en **Mode Ordinateur** si le terminal est difficile à afficher sur petit écran.

### Étape 2 : Lancer le Déploiement en Une Seule Ligne
Dans Cloud Shell, collez et exécutez la commande suivante :

```bash
gcloud run deploy vless-manager \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,PORT=8080,TARGET_HOST=montre-635195440423.us-central1.run.app,TARGET_PORT=443,TARGET_WS_PATH=/Telegram/@AM2_D3/@AHMAD3214,ADMIN_PASSWORD=Admin@Vless2026" \
  --memory=512Mi \
  --cpu=1
```

> **Note sur le laboratoire Skills Boost :**  
> Si le laboratoire interdit la création d'un deuxième service Cloud Run en raison d'un quota strict (limite à 1 service), l'erreur retournée sera `RESOURCE_EXHAUSTED` ou `QUOTA_EXCEEDED`.  
> Dans ce cas, vous pouvez utiliser directement l'application hébergée ici sur **Google AI Studio** : elle fonctionne 24h/24, sans expiration de session de laboratoire, et conserve vos comptes de façon pérenne.

---

## 3. Architecture et Fonctionnalités du Panneau

### 10 Vues Intégrées :
1. **Tableau de bord :** Statistiques en temps réel, indicateurs de santé moteur (sonde TLS), comptes expirant bientôt, audit récent.
2. **Créer un compte :** Génération cryptographique RFC 4122 d'UUID, durées pré-configurées (1j, 3j, 7j, 15j, 30j, 90j, personnalisé), quota Go ou illimité, paramètres réels du serveur Cloud Run.
3. **Tous les comptes :** Liste complète, recherche instantanée par nom/ID, tri, filtres VLESS / VMess.
4. **Comptes actifs :** Accès autorisés en cours de validité.
5. **Comptes expirés :** Comptes ayant dépassé leur date limite, désactivés automatiquement.
6. **Comptes suspendus :** Comptes mis en pause manuellement par l'administrateur.
7. **Statistiques :** Histogramme des expirations, répartition protocolaires, transparence sur les compteurs.
8. **Paramètres du moteur :** Diagnostic de connectivité en direct vers `montre`, intervalle keep-alive anti-mise en veille.
9. **Journaux d'activité (Audit) :** Historique traçable sans fuite de secrets ou d'UUIDs privés.
10. **Authentification Admin :** Session sécurisée avec mot de passe administrateur (`Admin@Vless2026`).

---

## 4. Tests Unitaires Automatisés

Pour exécuter la suite de tests complète (10/10 tests de validation) :

```bash
npm test
```

Résultats vérifiés :
- ✔ Format RFC 4122 UUID v4
- ✔ Encodage et paramètres des liens VLESS
- ✔ Encodage Base64 des configurations VMess
- ✔ Rejet des requêtes anonymes (Auth 401)
- ✔ Validation des noms et prévention des doublons
- ✔ Calcul et prolongation d'expiration
- ✔ Détection automatique des comptes expirés
- ✔ Transparence sur l'absence de compteurs de trafic
- ✔ Protection absolue du service existant
- ✔ Traçabilité d'audit sans exposition de secrets
