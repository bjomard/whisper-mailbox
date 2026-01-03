---

# 🚀 Quickstart — ENS Demo (Alice ↔ Bob)

Cette démo montre un **envoi de message chiffré P2P via ENS**, en utilisant :

* un **mailbox server WHISPER**
* une **ContactCard publiée via ENS**
* un **flow Alice → Bob**
* **sans hardware dédié** (MVP logiciel)

---

## 🧩 Prérequis

* Node.js ≥ 18
* Rust + Cargo
* `jq`, `curl`
* Un repo **public** GitHub (pour GitHub Pages)
* Un domaine ENS de test
  👉 ex: `bob.wspr.f3nixid.eth`
* RPC Ethereum (Sepolia) configuré (`RPC_URL`)
* Wallet propriétaire de `f3nixid.eth` (clé privée **uniquement côté opérateur ENS**)

---

## 🧑‍💻 Terminal 1 — Bob (récepteur)

### 1️⃣ Lancer le mailbox server

```bash
cargo run
```

Par défaut :

```
listening on 0.0.0.0:8080
```

---

### 2️⃣ Créer la mailbox de Bob

```bash
curl -s -X POST http://localhost:8080/v1/mailboxes \
  -H "Content-Type: application/json" \
  --data '{}' | jq
```

➡️ **Bob récupère :**

```json
{
  "mailbox_id": "...",
  "poll_token": "...",
  "limits": { ... }
}
```

Export côté Bob :

```bash
export MAILBOX_ID=...
export POLL_TOKEN=...
```

---

### 3️⃣ (Optionnel) Générer un DEPOSIT_TOKEN

```bash
./scripts/register_deposit_token.sh
```

➡️ Bob transmet ce `DEPOSIT_TOKEN` à Alice **out-of-band** (MVP).

---

### 4️⃣ Publier la ContactCard de Bob

#### a) Éditer `profiles/bob.json`

```json
{
  "v": 1,
  "service": "whisper",
  "handle": "bob.wspr.f3nixid.eth",
  "mailboxes": [
    { "url": "http://localhost:8080", "id": "<MAILBOX_ID>", "prio": 10 }
  ],
  "pub": { ... }
}
```

#### b) Canonicaliser + signer

```bash
node --loader ts-node/esm scripts/canonicalize_json.ts profiles/bob.json > profiles/bob.canon.json
node --loader ts-node/esm scripts/sign_profile.ts profiles/bob.canon.json > profiles/bob.signed.json
```

---

#### c) Publier via GitHub Pages

Copier :

```bash
cp profiles/bob.canon.json docs/profiles/
git add docs/profiles/bob.canon.json
git commit -m "Publish Bob ContactCard"
git push
```

URL finale :

```
https://<user>.github.io/<repo>/profiles/bob.canon.json
```

---

#### d) Publier le pointeur ENS

```bash
node dist/publish_pointer.js \
  "bob.wspr.f3nixid.eth" \
  "https://<user>.github.io/<repo>/profiles/bob.canon.json" \
  <sha256> <sig>
```

Vérification :

```bash
node dist/resolve_verify.js "bob.wspr.f3nixid.eth"
```

---

### 5️⃣ Poll côté Bob

```bash
./scripts/poll_bob.sh
```

---

## 🧑‍💻 Terminal 2 — Alice (émetteur)

### 1️⃣ Configurer l’environnement

```bash
export RPC_URL=...
export DEPOSIT_TOKEN=...   # fourni par Bob
```

---

### 2️⃣ Envoyer un message via ENS

```bash
./scripts/send_via_ens.sh "bob.wspr.f3nixid.eth" "hello bob via ENS"
```

Ce que fait le script :

1. Résolution ENS
2. Vérification hash + signature
3. Téléchargement ContactCard
4. Sélection mailbox (prio)
5. Dépôt du message

---

## ✅ Résultat attendu

* Alice n’a **aucune info directe** sur Bob
* Bob reçoit le message via `poll_bob.sh`
* ENS est utilisé comme **root of trust**
* Aucun backend central requis

---

## 🧠 Notes d’architecture

* ENS = **annuaire public**
* ContactCard = **binding identité → mailbox**
* Mailbox = **buffer éphémère**
* DEPOSIT_TOKEN = **anti-spam MVP**
* Aucun message lisible par le serveur

---
