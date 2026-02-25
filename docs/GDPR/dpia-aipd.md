# 📄 DPIA / AIPD — DocGather

> **Project code name:** DocGather  
> **Document type:** Data Protection Impact Assessment (DPIA / AIPD)  
> **Last updated:** YYYY-MM-DD  
> **Status:** Living document

---

## 🇫🇷 VERSION FRANÇAISE — AIPD (RGPD)

---

## 1. Présentation générale du traitement

### 1.1 Nom du projet

**DocGather**

### 1.2 Responsable de traitement

DocGather (entité juridique à définir)

### 1.3 Description du service

DocGather est une solution SaaS permettant la **collecte, la classification automatisée, l’analyse et la sélection de documents administratifs, personnels et professionnels**, dans le cadre de démarches réglementées ou contractuelles (banque, assurance, RH, fiscalité, KYC/AML, formalités d’entreprise).

Le service est déployé **exclusivement sur des infrastructures situées dans l’Union européenne**.

---

## 2. Nécessité d’une AIPD

Ce traitement nécessite une AIPD conformément à l’article 35 du RGPD en raison :

- du traitement à grande échelle de **documents officiels et sensibles**
- de l’analyse automatisée de données personnelles
- des risques élevés pour les droits et libertés des personnes concernées

---

## 3. Description détaillée des traitements

### 3.1 Catégories de personnes concernées

- Particuliers
- Salariés et indépendants
- Représentants légaux
- Dirigeants et bénéficiaires effectifs
- Clients professionnels (banques, assurances, entreprises, administrations)

---

### 3.2 Catégories de documents traités

_(Voir section détaillée précédente : preuves d’identité, de domicile, de revenus, documents financiers, fiscaux, contractuels, d’état civil et documents d’entreprise.)_

---

## 4. Finalités du traitement

Les données sont traitées exclusivement pour :

- la collecte sécurisée de documents
- la classification et l’analyse automatisées
- la vérification de complétude et de conformité
- la transmission contrôlée aux organismes habilités
- la réduction des erreurs, délais et risques de fraude

Aucune donnée n’est utilisée à des fins de prospection commerciale ou d’entraînement de modèles sans consentement explicite.

---

## 5. Base légale du traitement

- Exécution d’un contrat (article 6.1.b RGPD)
- Obligation légale (KYC, AML, obligations réglementaires)
- Consentement explicite pour les données sensibles (article 9.2.a)

---

## 6. Localisation des données et infrastructure (EU ONLY)

### 6.1 Hébergement et stockage

- L’ensemble des données est hébergé **exclusivement dans l’Union européenne**
- Utilisation de **Supabase avec des serveurs localisés dans l’UE**
- Aucun transfert de données hors UE par défaut
- Les environnements de développement, de test et de production sont isolés

---

### 6.2 Traitements d’IA et d’analyse automatisée

Les traitements de classification, d’analyse documentaire et d’extraction de données sont réalisés :

- exclusivement sur des **plateformes d’IA basées dans l’Union européenne**
- auprès de fournisseurs respectant le RGPD et le droit européen

Exemples de fournisseurs envisagés :

- **OVHcloud AI Endpoints**
- **Mistral AI**
- ou toute autre plateforme européenne équivalente

---

### 6.3 Garanties contractuelles relatives à l’IA

Pour tous les fournisseurs d’IA utilisés :

- **Aucune conservation des prompts ou documents à des fins d’entraînement**
- **Aucune réutilisation des données clients**
- Engagements contractuels explicites sur :
  - la non-rétention
  - la confidentialité
  - la suppression immédiate ou à court terme
- Accords de sous-traitance (DPA) négociés et documentés

---

## 7. Mesures de sécurité techniques et organisationnelles

### 7.1 Mesures techniques

- Chiffrement fort des documents avant stockage (AES-256)
- Buckets de stockage privés
- Chiffrement des clés (envelope encryption)
- Accès par URLs signées à durée limitée
- Politiques de sécurité au niveau ligne (RLS)
- Journalisation complète des accès
- Traitements sensibles via fonctions serveur isolées
- Aucun accès direct des clients aux données brutes

---

### 7.2 Mesures organisationnelles

- Accès restreint aux personnels habilités
- Séparation stricte des rôles
- Sensibilisation RGPD et sécurité
- Procédures de gestion des incidents
- Revues régulières des fournisseurs et sous-traitants

---

## 8. Transferts hors Union européenne

- **Aucun transfert hors UE par défaut**
- Tout transfert futur nécessiterait :
  - une analyse d’impact spécifique
  - des garanties appropriées (clauses contractuelles types, équivalence)
  - une information préalable des personnes concernées

---

## 9. Analyse des risques

| Risque                            | Impact     | Probabilité |
| --------------------------------- | ---------- | ----------- |
| Accès non autorisé                | Élevé      | Faible      |
| Fuite de documents sensibles      | Très élevé | Faible      |
| Mauvaise utilisation par un tiers | Élevé      | Faible      |
| Erreur de classification          | Moyen      | Moyen       |

---

## 10. Mesures de réduction des risques

- Chiffrement bout-en-bout
- Accès conditionné, journalisé et limité
- Isolation des traitements d’IA
- Fournisseurs IA européens et contractuellement engagés
- Tests de sécurité réguliers
- Plan de réponse aux incidents documenté

---

## 11. Droits des personnes concernées

Les personnes concernées disposent des droits suivants :

- droit d’accès
- droit de rectification
- droit à l’effacement
- droit à la limitation
- droit à la portabilité
- droit d’opposition

---

## 12. Conclusion de l’AIPD

Compte tenu :

- de l’hébergement **exclusivement européen**
- de l’utilisation de **fournisseurs d’IA européens sans réutilisation des données**
- des mesures de sécurité techniques et organisationnelles mises en œuvre

les **risques résiduels sont jugés acceptables**.  
Le traitement peut être mis en œuvre conformément au RGPD, sous réserve d’une réévaluation périodique.

---

---

## 🇬🇧 ENGLISH VERSION — DPIA (GDPR)

---

## 1. General Overview

### 1.1 Project Name

**DocGather**

### 1.2 Data Controller

DocGather (legal entity to be defined)

### 1.3 Service Description

DocGather is a SaaS platform designed to securely collect, classify, analyze, and select personal and business documents for regulated administrative and contractual processes.

All infrastructure is hosted **exclusively within the European Union**.

---

## 2. Need for a DPIA

This processing requires a DPIA under Article 35 GDPR due to large-scale processing of sensitive documents and automated analysis.

---

## 3. Data Localization and Infrastructure (EU ONLY)

### 3.1 Hosting and Storage

- All data is hosted exclusively within the European Union
- Supabase EU-based servers are used
- Document processing (OCR, extraction, thumbnail generation) runs on **Fly.io workers in EU regions** (Paris, Frankfurt)
- No data transfers outside the EU by default
- Environment separation (dev / test / prod)

---

### 3.2 AI Processing

Automated document analysis is performed:

- exclusively on **EU-based AI platforms**
- using providers compliant with GDPR and EU law

Examples:

- OVHcloud AI Endpoints
- Mistral AI
- Equivalent EU AI providers

---

### 3.3 AI Data Protection Guarantees

For all AI providers:

- No prompt or document retention for training
- No reuse of customer data
- Explicit contractual commitments
- Data Processing Agreements in place

---

## 4. Security Measures

- Strong encryption (AES-256)
- Private storage
- Key separation
- Time-limited access
- Full access logging
- Isolated AI processing

---

## 5. International Transfers

- No transfers outside the EU by default
- Any future transfer subject to additional safeguards

---

## 6. DPIA Conclusion

Considering EU-only infrastructure and strict AI data handling guarantees, **residual risks are acceptable**, and the processing complies with GDPR requirements.

---
