# 📘 Whisper Onboarding - Guide Complet

## 🎯 Vue d'ensemble

Ce système permet de créer et d'enregistrer des profils Whisper sur Ethereum Name Service (ENS), avec leurs clés publiques et ContactCards.

### Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                     Whisper Profile                          │
├─────────────────────────────────────────────────────────────┤
│  ENS Name: alice.wspr.f3nixid.eth                           │
│  ├─ Owner: 0xa8ABBb... (PUBLISHER)                          │
│  ├─ Resolver: 0xF29... ou 0x231... (ENS Resolver)           │
│  └─ Data:                                                    │
│      ├─ f3nix.wspr.uri → ContactCard URL                    │
│      ├─ f3nix.wspr.sha256 → Hash de la ContactCard          │
│      ├─ f3nix.wspr.sig → Signature                          │
│      ├─ f3nix.wspr.publisher → Adresse du publisher         │
│      └─ f3nix.wspr.root_signer → Adresse racine (Ledger)    │
└─────────────────────────────────────────────────────────────┘
```

### Hiérarchie de clés
```
ROOT_SIGNER (Ledger/Cold)
    │
    ├─ [Délégation signée]
    │
    ▼
PUBLISHER (Hot Key)
    │
    ├─ Crée et signe les ContactCards
    │
    ▼
USAGE KEYS (Ed25519 + X25519)
    │
    └─ Clés de messagerie quotidienne
```

---

## 🔧 Prérequis

### Variables d'environnement requises
```bash
# Dans ~/.bashrc, ~/.zshrc, ou .env

# RPC Ethereum
export RPC_URL="https://1rpc.io/eth"

# Clé privée publisher (hot key)
export PUBLISHER_PRIVATE_KEY="0x..."

# Adresse racine (Ledger/cold wallet)
export ROOT_SIGNER="0x9835687c0eC5228913A79Fcfc11F6ac0712DE7Bb"

# URLs des mailboxes Whisper
export MAILBOX_URLS="https://mailbox.example.com"

# Répertoire des secrets (optionnel)
export SECRETS_ROOT="$HOME/F3NIX-Secrets/whisper"
```

### Outils nécessaires

- `cast` (Foundry)
- `jq`
- `node` / `npm`
- `git`
- `curl`
- `shasum`
- `python3`

---

## 📋 Processus d'Onboarding

### Méthode 1 : Script automatisé (Recommandé)
```bash
cd /Users/bjomard/F3NIX-Whisper/whisper-mailbox

# Pour un nouveau profil avec le Public Resolver (recommandé)
./scripts/create_and_onboard.sh alice

# Pour un profil avec l'ancien resolver (comme Bertrand)
# Voir Méthode 2
```

### Méthode 2 : Manuelle (contrôle total)

#### Étape 1 : Générer les clés
```bash
cd /Users/bjomard/F3NIX-Whisper/whisper-mailbox

ALIAS="alice"

# Générer les clés Ed25519 et X25519
ens/scripts/whisper-keygen.sh "$ALIAS"

# Les clés sont sauvegardées dans :
# $HOME/F3NIX-Secrets/whisper/users/alice/whisper.keys.json
```

**Format du fichier de clés :**
```json
{
  "public": {
    "ed25519_spki_b64u": "...",
    "x25519_spki_b64u": "..."
  },
  "private": {
    "ed25519_seed": "...",
    "x25519_seed": "..."
  }
}
```

#### Étape 2 : Créer le sous-domaine ENS

**Option A : Avec le Public Resolver (recommandé pour nouveaux profils)**
```bash
PUBLIC_RESOLVER="0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63"

cast send --rpc-url "$RPC_URL" --private-key "$PUBLISHER_PRIVATE_KEY" \
  0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
  "setSubnodeRecord(bytes32,bytes32,address,address,uint64)" \
  $(cast namehash wspr.f3nixid.eth) \
  $(cast keccak "$ALIAS") \
  "0xa8ABBb681425370962CaA2a713cf1b40b3a64A3c" \
  "$PUBLIC_RESOLVER" \
  0

# Attendre la confirmation
sleep 15
```

**Option B : Avec l'ancien resolver (compatibilité Bertrand)**
```bash
OLD_RESOLVER="0xF29100983E058B709F3D539b0c765937B804AC15"

cast send --rpc-url "$RPC_URL" --private-key "$PUBLISHER_PRIVATE_KEY" \
  0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
  "setSubnodeRecord(bytes32,bytes32,address,address,uint64)" \
  $(cast namehash wspr.f3nixid.eth) \
  $(cast keccak "$ALIAS") \
  "0xa8ABBb681425370962CaA2a713cf1b40b3a64A3c" \
  "$OLD_RESOLVER" \
  0

sleep 15
```

#### Étape 3 : Onboarder le profil
```bash
PUBKEYS="$HOME/F3NIX-Secrets/whisper/users/$ALIAS/whisper.keys.json"

env -u EXPECTED_RESOLVER \
REUSE_EXISTING=1 SKIP_PROVISION=1 \
ens/scripts/whisper_onboard.sh "$ALIAS" "$PUBKEYS"
```

**Ce que fait cette commande :**
1. Vérifie la disponibilité du nom ENS
2. Crée la ContactCard JSON avec les clés publiques
3. Publie la ContactCard sur GitHub (commit pinné)
4. Calcule le hash SHA256 de la ContactCard
5. Signe le hash avec PUBLISHER_PRIVATE_KEY
6. Écrit toutes les données sur ENS (12 transactions)
7. Vérifie que tout fonctionne

#### Étape 4 : Vérifier le profil
```bash
cd ens
NODE_NO_WARNINGS=1 node --loader ts-node/esm scripts/resolve_verify.ts "$ALIAS.wspr.f3nixid.eth"
```

**Résultat attendu :**
```json
{
  "name": "alice.wspr.f3nixid.eth",
  "resolver": "0x...",
  "ver": "1",
  "uri": "https://raw.githubusercontent.com/.../alice.min.json",
  "sha256": "0x...",
  "publisher": "0xa8ABBb681425370962CaA2a713cf1b40b3a64A3c",
  "root_signer": "0x9835687c0eC5228913A79Fcfc11F6ac0712DE7Bb",
  "ok": true
}
```

---

## 🔍 Vérifications et Debugging

### Vérifier qu'un profil existe
```bash
# Vérifier le propriétaire
cast call --rpc-url "$RPC_URL" \
  0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
  "owner(bytes32)(address)" \
  $(cast namehash alice.wspr.f3nixid.eth)

# Vérifier le resolver
cast call --rpc-url "$RPC_URL" \
  0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
  "resolver(bytes32)(address)" \
  $(cast namehash alice.wspr.f3nixid.eth)
```

### Lire les données ENS
```bash
RESOLVER="0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63"  # ou 0xF29...

# Lire l'URI de la ContactCard
cast call --rpc-url "$RPC_URL" \
  "$RESOLVER" \
  "text(bytes32,string)(string)" \
  $(cast namehash alice.wspr.f3nixid.eth) \
  "f3nix.wspr.uri"

# Lire le hash
cast call --rpc-url "$RPC_URL" \
  "$RESOLVER" \
  "text(bytes32,string)(string)" \
  $(cast namehash alice.wspr.f3nixid.eth) \
  "f3nix.wspr.sha256"
```

### Télécharger la ContactCard
```bash
# Récupérer l'URI depuis ENS
URI=$(cast call --rpc-url "$RPC_URL" \
  "$RESOLVER" \
  "text(bytes32,string)(string)" \
  $(cast namehash alice.wspr.f3nixid.eth) \
  "f3nix.wspr.uri")

# Télécharger et afficher
curl -s "$URI" | jq .
```

---

## 🚨 Résolution de problèmes

### Problème : "ENS name already owned"

**Solution :** Ajoutez `REUSE_EXISTING=1`
```bash
REUSE_EXISTING=1 ens/scripts/whisper_onboard.sh alice "$PUBKEYS"
```

### Problème : "No resolver found"

**Causes possibles :**
1. Le sous-domaine n'a pas été créé
2. Le resolver n'est pas encore propagé (attendre 30s)
3. Cache RPC

**Solutions :**
```bash
# 1. Vérifier si le resolver existe
cast call --rpc-url "$RPC_URL" \
  0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
  "resolver(bytes32)(address)" \
  $(cast namehash alice.wspr.f3nixid.eth)

# 2. Attendre et réessayer
sleep 30

# 3. Utiliser un autre RPC
RPC_URL="https://eth.llamarpc.com" \
ens/scripts/whisper_onboard.sh alice "$PUBKEYS"
```

### Problème : "missing revert data" lors de l'écriture ENS

**Cause :** Pas de permissions d'écriture sur le resolver

**Solution :** Utiliser le Public Resolver au lieu de l'ancien resolver
```bash
# Changer le resolver
cast send --rpc-url "$RPC_URL" --private-key "$PUBLISHER_PRIVATE_KEY" \
  0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
  "setResolver(bytes32,address)" \
  $(cast namehash alice.wspr.f3nixid.eth) \
  "0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63"
```

### Problème : Transaction timeout

**Solution :** La transaction est probablement en attente
```bash
# Attendre 30 secondes et vérifier
sleep 30
cast call --rpc-url "$RPC_URL" \
  0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e \
  "owner(bytes32)(address)" \
  $(cast namehash alice.wspr.f3nixid.eth)

# Si propriétaire != 0x000..., continuer l'onboarding
```

---

## 📊 État des Profils

### Profils existants

| Profil | Resolver | Status | Notes |
|--------|----------|--------|-------|
| bertrand | `0xF29...` | ✅ Opérationnel | Premier profil, resolver custom |
| alice | `0xF29...` | ✅ Opérationnel | Ancien resolver |
| christophe | `0xF29...` | ✅ Opérationnel | Ancien resolver |
| paul | `0xF29...` | ✅ Opérationnel | Ancien resolver |
| charlie | `0x231...` | ✅ Opérationnel | Public Resolver (test) |
| david | `0xF29...` | ✅ Opérationnel | Ancien resolver (validation) |
| Max | Mixte | ❌ Abandonné | Problème de permissions |

### Resolvers disponibles

**Ancien resolver (custom) :**
- Adresse : `0xF29100983E058B709F3D539b0c765937B804AC15`
- Utilisé par : bertrand, alice, christophe, paul, david
- Limites : Permissions restrictives pour nouveaux noms

**Public Resolver (ENS officiel) :**
- Adresse : `0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63`
- Utilisé par : charlie
- Avantages : Standard, permissif, bien supporté

---

## 🔐 Sécurité

### Hiérarchie de clés

1. **ROOT_SIGNER** (Cold Wallet - Ledger)
   - Utilisation : Signer les délégations uniquement
   - Sécurité : Maximale, jamais exposée
   - Révocabilité : Non (identité racine)

2. **PUBLISHER_PRIVATE_KEY** (Hot Key)
   - Utilisation : Créer et publier les ContactCards
   - Sécurité : Moyenne, exposée sur le serveur
   - Révocabilité : Oui (via nouvelle délégation)

3. **Usage Keys** (Ed25519 + X25519)
   - Utilisation : Messagerie quotidienne
   - Sécurité : Variable selon l'appareil
   - Révocabilité : Oui (nouvelle ContactCard)

### Protection des secrets
```bash
# Permissions strictes sur les clés
chmod 700 "$HOME/F3NIX-Secrets/whisper"
chmod 700 "$HOME/F3NIX-Secrets/whisper/users"
chmod 700 "$HOME/F3NIX-Secrets/whisper/users/"*
chmod 600 "$HOME/F3NIX-Secrets/whisper/users/"*/whisper.keys.json

# Ne JAMAIS commiter les secrets dans Git
echo "F3NIX-Secrets/" >> .gitignore
echo ".env" >> .gitignore
```

### Délégation (optionnelle mais recommandée)

La délégation permet de prouver que PUBLISHER est autorisé par ROOT_SIGNER.

**Créer une délégation :**
```bash
# TODO: Implémenter avec Ledger
# 1. Créer l'objet de délégation
# 2. Signer avec ROOT_SIGNER (Ledger)
# 3. Sauvegarder dans ens/scripts/delegation_signed.json
```

---

## 📝 Scripts Disponibles

### `/scripts/create_and_onboard.sh`

Script automatisé complet pour créer un nouveau profil.

**Usage :**
```bash
./scripts/create_and_onboard.sh <alias>
```

**Ce qu'il fait :**
1. Génère les clés
2. Crée le sous-domaine ENS avec Public Resolver
3. Onboarde le profil
4. Vérifie le résultat

### `/ens/scripts/whisper-keygen.sh`

Génère une paire de clés Ed25519 + X25519.

**Usage :**
```bash
ens/scripts/whisper-keygen.sh <alias>
```

**Output :**
- `$HOME/F3NIX-Secrets/whisper/users/<alias>/whisper.keys.json`

### `/ens/scripts/whisper_onboard.sh`

Script principal d'onboarding.

**Usage :**
```bash
ens/scripts/whisper_onboard.sh <alias> <path/to/keys.json>
```

**Variables d'environnement :**
- `REUSE_EXISTING=1` : Réutiliser un nom existant
- `SKIP_PROVISION=1` : Ne pas provisionner (si déjà fait)
- `EXPECTED_RESOLVER` : Forcer un resolver spécifique (pas recommandé)

### `/ens/scripts/resolve_verify.ts`

Vérifie qu'un profil Whisper est correctement configuré.

**Usage :**
```bash
cd ens
NODE_NO_WARNINGS=1 node --loader ts-node/esm scripts/resolve_verify.ts <name.wspr.f3nixid.eth>
```

---

## 🎯 Flux de Résolution (Comment les autres trouvent votre profil)
```
1. User demande à contacter "alice.wspr.f3nixid.eth"
   ↓
2. ENS Registry: Quel est le resolver d'Alice?
   → 0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63
   ↓
3. Resolver: Donne-moi "f3nix.wspr.uri" pour Alice
   → https://raw.githubusercontent.com/.../alice.min.json
   ↓
4. Télécharge la ContactCard depuis GitHub
   ↓
5. Vérifie le hash SHA256
   ENS sha256 == SHA256(ContactCard téléchargée) ✓
   ↓
6. Vérifie la signature
   ethers.verifyMessage(sha256, signature) == PUBLISHER ✓
   ↓
7. Extrait les clés publiques
   - ed25519_spki_b64u (signature)
   - x25519_spki_b64u (chiffrement)
   ↓
8. Peut maintenant envoyer des messages chiffrés à Alice!
```

---

## 📚 Ressources

### Documentation ENS
- ENS Registry: https://docs.ens.domains/
- Public Resolver: https://docs.ens.domains/resolvers/public-resolver

### Outils
- Foundry (cast): https://book.getfoundry.sh/
- Ethers.js: https://docs.ethers.org/

### Explorateurs
- Etherscan: https://etherscan.io/
- ContactCards GitHub: https://github.com/bjomard/ContactCards

---

## 🔄 Mise à Jour d'un Profil

Pour mettre à jour la ContactCard d'un profil existant :
```bash
ALIAS="alice"
PUBKEYS="$HOME/F3NIX-Secrets/whisper/users/$ALIAS/whisper.keys.json"

# Relancer l'onboarding (écrase les anciennes données)
REUSE_EXISTING=1 SKIP_PROVISION=1 \
ens/scripts/whisper_onboard.sh "$ALIAS" "$PUBKEYS"
```

**Note :** Cela génère un nouveau commit GitHub avec la nouvelle ContactCard.

---

## ⚠️ Limitations Connues

1. **Max.wspr.f3nixid.eth** : Problème de permissions avec le resolver mixte (abandonné)
2. **Délégation** : Non implémentée automatiquement (nécessite Ledger)
3. **Gas fees** : Environ 12 transactions par profil (~$5-20 selon le prix du gas)
4. **Temps d'onboarding** : 2-3 minutes par profil sur mainnet

---

## 🎓 Concepts Clés

### ENS (Ethereum Name Service)
Système de noms décentralisé qui mappe des noms lisibles (alice.wspr.f3nixid.eth) vers des ressources (adresses, contenus, etc.).

### Resolver
Contrat intelligent qui stocke les données associées à un nom ENS. Comme une "base de données" pour les informations du profil.

### ContactCard
Fichier JSON contenant les clés publiques et métadonnées d'un profil Whisper. Publié sur GitHub et référencé depuis ENS.

### SPKI (Subject Public Key Info)
Format standard pour encoder les clés publiques. Utilisé pour Ed25519 (signature) et X25519 (chiffrement).

---

## ✅ Checklist de Création de Profil

- [ ] Variables d'environnement configurées (RPC_URL, PUBLISHER_PRIVATE_KEY, ROOT_SIGNER)
- [ ] Nom de profil choisi (ex: alice)
- [ ] Clés générées avec whisper-keygen.sh
- [ ] Sous-domaine ENS créé avec setSubnodeRecord
- [ ] Onboarding exécuté avec REUSE_EXISTING=1 SKIP_PROVISION=1
- [ ] Vérification réussie avec resolve_verify.ts
- [ ] ContactCard accessible sur GitHub
- [ ] Données ENS vérifiées avec cast call

---

**Version:** 1.0  
**Dernière mise à jour:** $(date +%Y-%m-%d)  
**Auteur:** Équipe F3NIX Whisper  
**Contact:** [À compléter]

