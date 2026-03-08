import useStore from './store/useStore';

const translations = {
  en: {
    // Nav / general
    sign_out: 'Sign out',
    loading: 'Loading...',
    cancel: 'Cancel',
    all: 'All',

    // Agent
    new_ticket: '+ New ticket',
    hello: 'Hello',
    choose_dept_desc: 'Choose a department and describe your question.',
    technical: 'Technical',
    dare_reference: 'Dare Reference',
    customer_case_number: 'Customer / Case number',
    optional: 'optional',
    dare_placeholder: 'e.g. DARE-789',
    case_placeholder: 'e.g. C-123456',
    question_problem: 'Question / problem',
    describe_problem: 'Describe the problem...',
    connecting: 'Connecting...',
    connect_with_expert: 'Connect with expert',

    // Chat window
    waiting_for_expert: 'Waiting for an expert...',
    close: 'Close',
    no_messages: 'No messages yet.',
    ticket_closed_notice: 'This ticket has been closed.',
    close_ticket_title: 'Close ticket?',
    close_ticket_body: 'The chat will be closed for both the agent and the expert. This cannot be undone.',
    yes_close: 'Yes, close',
    type_message: 'Type a message... (Ctrl+V to paste screenshot)',
    send: 'Send',
    uploading: 'Uploading\u2026',

    // Message bubble
    translation: 'Translation',
    original: 'Original',
    translated_for_recipient: 'translated for recipient',

    // Ticket list
    no_tickets: 'No tickets found.',

    // Business hours guard
    expert_chat_closed: 'Expert chat closed',
    expert_chat_closed_body: 'The expert chat is currently closed. Available Monday to Sunday between 07:30 and 22:30.',

    // Login
    select_user: 'Select your user to log in (demo)',
    no_users: 'No users found.',

    // Expert view
    queue: 'Queue',
    waiting: 'waiting',
    active: 'active',
    no_open_tickets: 'No open tickets',
    in_progress: 'in progress',
    waiting_badge: 'waiting',
    lang_label: 'Lang',
    jump_in: 'Jump in',
    join: 'Join',
    open: 'Open',
    ready_to_help: 'Ready to help',
    select_ticket_hint: 'Select a ticket from the queue and click "Join".',

    // Whisper
    whisper_mode: 'Whisper mode',
    whisper_hint: 'Only visible to experts & managers',
    whisper_label: 'whisper',

    // Manager view
    statistics: 'Statistics',
    open_tickets: 'Open tickets',
    archive: 'Archive',
    dashboard: 'Dashboard',
    tickets_today: 'Tickets today',
    closed: 'Closed',
    avg_response_time: 'Avg. response time',
    total_tickets: 'Total tickets',
    distribution: 'Distribution DSC / FOT',
    archive_title: 'Archive \u2014 closed tickets',
    search_placeholder: 'Search by title or agent...',
    no_closed_tickets: 'No closed tickets found.',
    col_title: 'Title',
    col_dept: 'Dept',
    col_agent: 'Agent',
    col_expert: 'Expert',
    col_created: 'Created',
    col_closed: 'Closed',

    // Feedback
    feedback: 'Feedback',
    feedback_desc: 'Share your suggestions or report an issue.',
    feedback_placeholder: 'What would you like to share?',
    submit_feedback: 'Send',
    feedback_sent: 'Thank you for your feedback!',

    // Rating
    rate_experience: 'Rate your experience',
    rate_expert_desc: 'How was your session with',
    rating_comment_placeholder: 'Any additional comments? (optional)',
    submit_rating: 'Submit',
    skip: 'Skip',
    rating_saved: 'Thanks for your rating!',

    // Reactions
    add_reaction: 'Add reaction',
  },

  fr: {
    sign_out: 'Se d\u00e9connecter',
    loading: 'Chargement...',
    cancel: 'Annuler',
    all: 'Tous',

    new_ticket: '+ Nouveau ticket',
    hello: 'Bonjour',
    choose_dept_desc: 'Choisissez un d\u00e9partement et d\u00e9crivez votre question.',
    technical: 'Technique',
    dare_reference: 'R\u00e9f\u00e9rence Dare',
    customer_case_number: 'N\u00b0 client / dossier',
    optional: 'optionnel',
    dare_placeholder: 'ex. DARE-789',
    case_placeholder: 'ex. C-123456',
    question_problem: 'Question / probl\u00e8me',
    describe_problem: 'D\u00e9crivez le probl\u00e8me...',
    connecting: 'Connexion en cours...',
    connect_with_expert: "Contacter un expert",

    waiting_for_expert: "En attente d'un expert...",
    close: 'Fermer',
    no_messages: 'Aucun message pour l\u2019instant.',
    ticket_closed_notice: 'Ce ticket a \u00e9t\u00e9 ferm\u00e9.',
    close_ticket_title: 'Fermer le ticket\u00a0?',
    close_ticket_body: "Le chat sera ferm\u00e9 pour l'agent et l'expert. Cette action est irr\u00e9versible.",
    yes_close: 'Oui, fermer',
    type_message: 'Tapez un message... (Ctrl+V pour coller une capture)',
    send: 'Envoyer',
    uploading: 'T\u00e9l\u00e9chargement\u2026',

    translation: 'Traduction',
    original: 'Original',
    translated_for_recipient: 'traduit pour le destinataire',

    no_tickets: 'Aucun ticket trouv\u00e9.',

    expert_chat_closed: 'Chat expert ferm\u00e9',
    expert_chat_closed_body: 'Le chat expert est actuellement ferm\u00e9. Disponible du lundi au dimanche entre 07h30 et 22h30.',

    select_user: 'S\u00e9lectionnez votre utilisateur pour vous connecter (d\u00e9mo)',
    no_users: 'Aucun utilisateur trouv\u00e9.',

    whisper_mode: 'Mode chuchotement',
    whisper_hint: 'Visible uniquement aux experts & managers',
    whisper_label: 'chuchotement',

    queue: 'File d\u2019attente',
    waiting: 'en attente',
    active: 'actif',
    no_open_tickets: 'Aucun ticket ouvert',
    in_progress: 'en cours',
    waiting_badge: 'en attente',
    lang_label: 'Langue',
    jump_in: 'Rejoindre',
    join: 'Rejoindre',
    open: 'Ouvrir',
    ready_to_help: 'Pr\u00eat \u00e0 aider',
    select_ticket_hint: 'S\u00e9lectionnez un ticket dans la file et cliquez sur \u00ab\u00a0Rejoindre\u00a0\u00bb.',

    statistics: 'Statistiques',
    open_tickets: 'Tickets ouverts',
    archive: 'Archive',
    dashboard: 'Tableau de bord',
    tickets_today: "Tickets aujourd'hui",
    closed: 'Ferm\u00e9s',
    avg_response_time: 'Temps de r\u00e9ponse moy.',
    total_tickets: 'Total tickets',
    distribution: 'R\u00e9partition DSC / FOT',
    archive_title: 'Archive \u2014 tickets ferm\u00e9s',
    search_placeholder: 'Rechercher par titre ou agent...',
    no_closed_tickets: 'Aucun ticket ferm\u00e9 trouv\u00e9.',
    col_title: 'Titre',
    col_dept: 'D\u00e9pt',
    col_agent: 'Agent',
    col_expert: 'Expert',
    col_created: 'Cr\u00e9\u00e9',
    col_closed: 'Ferm\u00e9',

    feedback: 'Feedback',
    feedback_desc: 'Partagez vos suggestions ou signalez un probl\u00e8me.',
    feedback_placeholder: 'Que souhaitez-vous partager\u00a0?',
    submit_feedback: 'Envoyer',
    feedback_sent: 'Merci pour votre retour\u00a0!',

    rate_experience: '\u00c9valuez votre exp\u00e9rience',
    rate_expert_desc: 'Comment \u00e9tait votre session avec',
    rating_comment_placeholder: 'Commentaires suppl\u00e9mentaires\u00a0? (optionnel)',
    submit_rating: 'Soumettre',
    skip: 'Passer',
    rating_saved: 'Merci pour votre \u00e9valuation\u00a0!',

    add_reaction: 'Ajouter une r\u00e9action',
  },

  nl: {
    sign_out: 'Afmelden',
    loading: 'Laden...',
    cancel: 'Annuleren',
    all: 'Alle',

    new_ticket: '+ Nieuw ticket',
    hello: 'Hallo',
    choose_dept_desc: 'Kies een departement en beschrijf je vraag.',
    technical: 'Technisch',
    dare_reference: 'Dare Referentie',
    customer_case_number: 'Klantnummer / Casenummer',
    optional: 'optioneel',
    dare_placeholder: 'bv. DARE-789',
    case_placeholder: 'bv. C-123456',
    question_problem: 'Vraag / probleem',
    describe_problem: 'Beschrijf het probleem...',
    connecting: 'Verbinden...',
    connect_with_expert: 'Verbind met expert',

    waiting_for_expert: 'Wachten op een expert...',
    close: 'Sluiten',
    no_messages: 'Nog geen berichten.',
    ticket_closed_notice: 'Dit ticket is gesloten.',
    close_ticket_title: 'Ticket sluiten?',
    close_ticket_body: 'De chat wordt afgesloten voor zowel de agent als de expert. Dit kan niet ongedaan worden gemaakt.',
    yes_close: 'Ja, sluiten',
    type_message: 'Typ een bericht... (Ctrl+V voor screenshot)',
    send: 'Stuur',
    uploading: 'Uploaden\u2026',

    translation: 'Vertaling',
    original: 'Origineel',
    translated_for_recipient: 'vertaald naar ontvanger',

    no_tickets: 'Geen tickets gevonden.',

    expert_chat_closed: 'Expertchat gesloten',
    expert_chat_closed_body: 'De expertchat is momenteel gesloten. Beschikbaar van maandag t/m zondag tussen 07:30 en 22:30.',

    select_user: 'Kies je gebruiker om in te loggen (demo)',
    no_users: 'Geen gebruikers gevonden.',

    whisper_mode: 'Fluistermodus',
    whisper_hint: 'Alleen zichtbaar voor experts & managers',
    whisper_label: 'fluister',

    queue: 'Wachtrij',
    waiting: 'wachtend',
    active: 'actief',
    no_open_tickets: 'Geen open tickets',
    in_progress: 'in behandeling',
    waiting_badge: 'wachtend',
    lang_label: 'Taal',
    jump_in: 'Bijspringen',
    join: 'Join',
    open: 'Open',
    ready_to_help: 'Klaar om te helpen',
    select_ticket_hint: 'Selecteer een ticket uit de wachtrij en klik op "Join".',

    statistics: 'Statistieken',
    open_tickets: 'Open tickets',
    archive: 'Archief',
    dashboard: 'Dashboard',
    tickets_today: 'Tickets vandaag',
    closed: 'Gesloten',
    avg_response_time: 'Gem. responstijd',
    total_tickets: 'Totaal tickets',
    distribution: 'Verdeling DSC / FOT',
    archive_title: 'Archief \u2014 gesloten tickets',
    search_placeholder: 'Zoeken op titel of agent...',
    no_closed_tickets: 'Geen gesloten tickets gevonden.',
    col_title: 'Titel',
    col_dept: 'Dept',
    col_agent: 'Agent',
    col_expert: 'Expert',
    col_created: 'Aangemaakt',
    col_closed: 'Gesloten',

    feedback: 'Feedback',
    feedback_desc: 'Deel je suggesties of meld een probleem.',
    feedback_placeholder: 'Wat wil je delen?',
    submit_feedback: 'Verstuur',
    feedback_sent: 'Bedankt voor je feedback!',

    rate_experience: 'Beoordeel je ervaring',
    rate_expert_desc: 'Hoe was je sessie met',
    rating_comment_placeholder: 'Extra opmerkingen? (optioneel)',
    submit_rating: 'Verstuur',
    skip: 'Overslaan',
    rating_saved: 'Bedankt voor je beoordeling!',

    add_reaction: 'Reactie toevoegen',
  },
};

export function useT() {
  const { user } = useStore();
  const lang = user?.lang && translations[user.lang] ? user.lang : 'en';
  return (key) => translations[lang][key] ?? translations.en[key] ?? key;
}

// For components that render before login (e.g. LoginView)
export function tBrowser(key) {
  const lang = navigator.language.slice(0, 2);
  const t = translations[lang] || translations.en;
  return t[key] ?? translations.en[key] ?? key;
}
