# Partner Privacy Notice — AI Snippet

**For:** Partner organisations deploying Guichet. **Audience:** the worker (agent or expert) who uses Guichet.
**Purpose:** boilerplate paragraphs the partner can paste into the privacy notice handed to every worker on hiring or when AI features are first enabled. Satisfies GDPR Art. 13 (information to data subjects at collection time) for the AI-processing component of Guichet.

This is the **individual-worker information** required by CCT 81 §6 step 3 ("information to each worker individually") and Art. 13 GDPR. The **collective information** to the CE / CPPT is in [`WORKS_COUNCIL_DISCLOSURE.md`](WORKS_COUNCIL_DISCLOSURE.md). Both documents must be issued; one does not replace the other.

## Usage

1. Pick the language version that matches your worker handbook.
2. Replace every `[BRACKETED PLACEHOLDER]` with your organisation's value.
3. Paste into the AI / electronic-tools section of the worker privacy notice or employment handbook.
4. Re-issue when an `AiAction` is added, the provider region changes, or the partner's `ai_features` configuration changes materially.

## Nederlands (NL)

> ### Gebruik van AI in Guichet
>
> [PARTNER_NAAM] gebruikt het interne ondersteuningsplatform Guichet om communicatie tussen frontline-medewerkers en interne experten te faciliteren. Wanneer AI-functies zijn ingeschakeld, wordt een deel van de berichten door een AI-model verwerkt voor vertaling (NL/FR/EN), tekstverbetering, spraak-naar-tekst-dictatie of vergelijkbare ondersteunende doeleinden.
>
> **Welke gegevens over jou worden verwerkt:**
> - Je gebruikers-ID binnen Guichet en de partner-context waarin je werkt;
> - Datum, tijd, type en uitkomst van elke AI-actie die jij triggert;
> - Aantal verbruikte tokens en gebruikte modelversie (voor kostenattributie en capaciteitsplanning);
> - De volledige prompt- en antwoordinhoud wordt **alleen** bewaard wanneer [PARTNER_NAAM] de audit-verbositeit expliciet op "volledig" heeft gezet — standaard wordt alleen metadata bewaard.
>
> **Persoonsgegevens uit je berichttekst** (e-mailadressen, Belgische telefoonnummers, rijksregisternummers, kredietkaartnummers) worden automatisch verwijderd vóór de tekst de Guichet-server verlaat.
>
> **Rechtsgrond:** gerechtvaardigd belang van [PARTNER_NAAM] om interne communicatie efficiënt en kwalitatief te organiseren (art. 6 lid 1 sub f GDPR).
>
> **Provider:** Azure OpenAI van Microsoft, met data-residency in de EU (regio francecentral). Er is een verwerkersovereenkomst van kracht.
>
> **Bewaartermijn:** per-actie loggegevens worden maximaal 30 dagen bewaard, daarna omgezet in geaggregeerde tellingen zonder herleidbaarheid naar jou.
>
> **Doelbinding:** deze gegevens worden gebruikt voor kostentoerekening, rate-limit-bewaking, technische foutdiagnose en geaggregeerde trendanalyse. Ze worden **niet** gebruikt voor individuele prestatie-evaluatie, disciplinaire beslissingen of taakallocatie. Zou [PARTNER_NAAM] dit doel later willen uitbreiden, dan wordt jij en het CPPT/CE opnieuw geïnformeerd.
>
> **Jouw rechten:**
> - Recht op inzage en rectificatie van de gegevens over jou;
> - Recht om bezwaar te maken (GDPR art. 21): je kan via het profielmenu in Guichet de optie *"Anonimiseer mijn AI-gebruik"* aanzetten — alle AI-functies blijven werken, maar je naam wordt niet meer aan de logregels gekoppeld;
> - Recht op wissing volgens art. 17 GDPR, binnen de grenzen van het gerechtvaardigd bedrijfsbelang;
> - Recht om een klacht in te dienen bij de Gegevensbeschermingsautoriteit (GBA/APD).
>
> **Contactpersoon voor vragen over deze verwerking:** [DPO_NAAM_EN_EMAIL]

## Français (FR)

> ### Utilisation de l'IA dans Guichet
>
> [NOM_DU_PARTENAIRE] utilise la plateforme interne Guichet pour faciliter la communication entre les collaborateurs de première ligne et les experts internes. Lorsque les fonctions d'IA sont activées, une partie des messages est traitée par un modèle d'IA à des fins de traduction (NL/FR/EN), de reformulation, de dictée vocale ou de fonctions similaires d'assistance.
>
> **Quelles données vous concernant sont traitées :**
> - Votre identifiant utilisateur dans Guichet et le contexte partenaire dans lequel vous travaillez ;
> - Date, heure, type et résultat de chaque action IA que vous déclenchez ;
> - Nombre de tokens consommés et version du modèle utilisée (pour la facturation et la planification de capacité) ;
> - Le contenu complet du prompt et de la réponse n'est conservé que lorsque [NOM_DU_PARTENAIRE] a explicitement défini la verbosité d'audit sur « complète » — par défaut, seules les métadonnées sont conservées.
>
> **Les données personnelles dans le texte de votre message** (adresses e-mail, numéros de téléphone belges, NRN, numéros de carte de crédit) sont automatiquement supprimées avant que le texte ne quitte le serveur Guichet.
>
> **Base légale :** intérêt légitime de [NOM_DU_PARTENAIRE] à organiser efficacement et qualitativement la communication interne (art. 6 §1 f RGPD).
>
> **Fournisseur :** Azure OpenAI de Microsoft, avec résidence des données dans l'UE (région francecentral). Un accord de sous-traitance est en vigueur.
>
> **Durée de conservation :** les données de journal par action sont conservées au maximum 30 jours, puis converties en comptages agrégés sans lien identifiable avec vous.
>
> **Finalité limitée :** ces données sont utilisées pour la facturation, la surveillance des quotas, le diagnostic technique et l'analyse agrégée des tendances. Elles ne sont **pas** utilisées pour l'évaluation individuelle des performances, les décisions disciplinaires ou la répartition des tâches. Si [NOM_DU_PARTENAIRE] souhaitait étendre cette finalité ultérieurement, vous et le CPPT/CE en seriez informés à nouveau.
>
> **Vos droits :**
> - Droit d'accès et de rectification des données vous concernant ;
> - Droit d'opposition (art. 21 RGPD) : vous pouvez activer l'option *« Anonymiser mon usage de l'IA »* dans le menu profil de Guichet — toutes les fonctions IA restent actives, mais votre nom n'est plus lié aux entrées de journal ;
> - Droit à l'effacement selon l'art. 17 RGPD, dans les limites de l'intérêt légitime de l'entreprise ;
> - Droit d'introduire une plainte auprès de l'Autorité de protection des données (APD).
>
> **Contact pour toute question relative à ce traitement :** [NOM_ET_EMAIL_DPO]

## English (EN)

> ### Use of AI in Guichet
>
> [PARTNER_NAME] uses the internal support platform Guichet to facilitate communication between front-line staff and internal experts. When AI features are enabled, a subset of messages is processed by an AI model for translation (NL / FR / EN), text refinement, voice-to-text dictation, or similar assistance.
>
> **What data about you is processed:**
> - Your Guichet user ID and the partner context in which you operate;
> - Date, time, type, and outcome of every AI action you trigger;
> - Number of tokens consumed and model version used (for cost attribution and capacity planning);
> - Full prompt and response content is retained **only** when [PARTNER_NAME] has explicitly set audit verbosity to "full" — the default keeps metadata only.
>
> **Personal data in your message text** (email addresses, Belgian phone numbers, NRN, credit-card numbers) is automatically removed before the text leaves the Guichet server.
>
> **Lawful basis:** legitimate interest of [PARTNER_NAME] in operating internal communication efficiently and consistently (GDPR Art. 6(1)(f)).
>
> **Provider:** Microsoft Azure OpenAI, with data residency in the EU (region francecentral). A data-processing agreement is in place.
>
> **Retention:** per-action log data is retained for at most 30 days, after which it is aggregated into counts that cannot be linked back to you.
>
> **Purpose limitation:** this data is used for cost attribution, rate-limit enforcement, technical diagnostics, and aggregated trend analysis. It is **not** used for individual performance evaluation, disciplinary decisions, or task allocation. If [PARTNER_NAME] ever intends to expand this purpose, you and the CE / CPPT will be informed again.
>
> **Your rights:**
> - Right of access and rectification of the data about you;
> - Right to object (GDPR Art. 21): you can enable the *"Anonymize my AI usage"* toggle in the Guichet profile menu — all AI features keep working, but your name is no longer linked to log entries;
> - Right to erasure under GDPR Art. 17, within the bounds of the legitimate business interest;
> - Right to lodge a complaint with the Belgian Data Protection Authority (APD / GBA).
>
> **Contact for questions about this processing:** [DPO_NAME_AND_EMAIL]

## Versioning

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-05-12 | Initial NL / FR / EN boilerplate covering the six `AiAction`s shipped today and the per-membership opt-out toggle. |

Re-issue if `AiAction` set changes, provider region changes, audit-verbosity defaults change, or the purpose-limitation list changes.
