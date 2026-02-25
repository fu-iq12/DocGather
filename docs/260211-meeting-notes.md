# 📝 Compte Rendu de Réunion : Stratégie Produit & MVP

## 📅 Date & Contexte

Réunion d'alignement sur la stratégie produit (B2B2C), la définition du MVP et la préparation de la démo pour la levée de fonds.

## 🎯 Objectifs Principaux

- **Alignement Stratégique :** Valider le positionnement B2B2C (le produit entre par le pro mais sert le particulier).
- **Préparation Démo :** Définir le scénario de démonstration pour convaincre les Business Angels.
- **Organisation Technique :** Faire le point sur le développement backend et les outils de gestion.

---

## 🔑 Points Clés (Key Takeaways)

### 1. Stratégie Produit (B2B2C)

- **Approche "Cheval de Troie" :** Le produit est introduit via un prescripteur B2B (Agent immobilier, Banquier) qui demande un dossier. Le client final (Particulier/Indépendant) utilise l'app pour répondre et la conserve pour ses futures démarches personnelles.
- **Cible :** Indépendants, TPE et particuliers. On évite la confrontation directe avec les GED (Gestion Électronique Documentaire) de grandes entreprises (type SAP).
- **Différenciateur :** Fluidité des échanges ("Boucle de démo") et intelligence artificielle pour le classement/validation automatique.

### 2. Scénario de la Démo (Investisseurs)

- **Objectif :** Une interface visuellement impactante ("shiny") et simple.
- **Le Tunnel :**
  1.  **Côté Pro (Agent) :** Création d'une demande de dossier (liste de pièces requises).
  2.  **Côté Particulier :** Réception de la demande, scan/import des documents (Drive ou local), validation immédiate (ex: alerte si document expiré).
- **Financement :** La levée de fonds servira prioritairement à recruter des Commerciaux (Sales) et renforcer la Tech.

### 3. Avancement Technique

- **Backend (Guillaume) :** Le pipeline d'analyse de documents (API) avance bien. Capacité actuelle à détecter le type de document et sa validité (ex: détection de date d'expiration).
- **Frontend :** Utilisation de **Lovable** pour le prototypage rapide de l'interface.
- **Outils :** Migration vers une gestion de tâches structurée (type Jira/Linear) et centralisation du code sur GitHub.

### 4. Concurrence & Marché

- Mention de concurrents comme **Paperclass** (interface appréciée) et **DocAPI**.
- Nécessité de rassurer sur la sécurité (**RGPD**, notion de "coffre-fort administratif") tout en gardant une UX fluide.

---

## ✅ Plan d'Action (Action Items)

| Responsable            | Action Assignée                                                                                                         |
| :--------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| **Guillaume**          | **Backend API :** Continuer le développement du moteur d'analyse et préparer la "boucle technique" pour la démo.        |
| **Speaker 3** (PM/Ops) | **Organisation :** Configurer les accès (GitHub, Lovable) et mettre en place l'outil de suivi de tickets (Jira/Linear). |
| **Équipe**             | **Benchmarking :** Analyser en détail l'interface de _Paperclass_ (design, features) pour s'en inspirer.                |
| **Équipe**             | **Roadmap :** Distinguer clairement les features MVP des features futures pour le Pitch Deck.                           |
| **Tous**               | **Scénario Démo :** Figer les écrans clés (Dashboard Agent / Vue Client) pour le prototype visuel.                      |
