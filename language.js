(() => {
  const storageKey = 'generation-liaison-language';
  const translations = {
    'Génération Liaison': 'Génération Liaison',
    'Génération Liaison - Mobile': 'Generation Liaison - Mobile',
    'Génération Liaison - Espace Aidant': 'Generation Liaison - Family Space',
    'Génération Liaison - Espace Professionnel': 'Generation Liaison - Professional Space',
    'Administration — Génération Liaison': 'Administration — Generation Liaison',
    'Espace Soignants 🩺': 'Care Professionals 🩺',
    'Espace Proches & Aidants 👨‍👩‍👧‍👦': 'Family & Caregivers 👨‍👩‍👧‍👦',
    'Espace Proches 👨‍👩‍👧‍👦': 'Family Space 👨‍👩‍👧‍👦',
    'Espace intervenants 🩺': 'Professional Space 🩺',
    'Espace administrateur': 'Administrator area',
    'Administration Génération Liaison': 'Administration — Génération Liaison',
    'Le lien au quotidien': 'Connected every day',
    'Bien entouré, mieux accompagné': 'Better supported, together',
    'Un espace simple pour faciliter les échanges entre les seniors, leurs proches et les professionnels, avec un accès séparé aux services du quotidien.':
      'A simple space for seniors, their families, and professionals to stay connected, with separate access to everyday services.',
    'Suivi partagé': 'Shared updates',
    'Carnet de liaison': 'Activity log',
    'Alertes et assistance': 'Alerts and support',
    'Services du quotidien': 'Everyday services',
    'Vérification de la connexion...': 'Checking connection...',
    'Se connecter': 'Sign in',
    'S’inscrire': 'Sign up',
    "S'inscrire": 'Sign up',
    'Ouvrir l’application en ligne': 'Open the app online',
    'Télécharger l’application Android': 'Download the Android app',
    'Fichier APK Android. L’installation peut demander l’autorisation d’installer des applications provenant de cette source.':
      'Android APK file. You may need to allow installations from this source.',
    'Télécharger le bundle AAB pour la Play Console': 'Download the AAB bundle for Play Console',
    'Conditions d’utilisation': 'Terms of use',
    'Projet de tarifs et CGV': 'Pricing proposal and terms of sale',
    'Confidentialité': 'Privacy',
    'Fonctionnalités': 'Features',
    'Langue': 'Language',
    'Français': 'French',
    'Nom du senior suivi (facultatif)': 'Name of the senior you support (optional)',
    'Vous pouvez créer votre compte même si aucun senior n’est encore inscrit. Le suivi apparaîtra lorsqu’un senior rejoindra l’application et partagera son profil.':
      'You can create your account even if no senior is registered yet. Updates will appear when a senior joins the app and shares their profile.',
    'Je suis tuteur légal et souhaite accéder aux profils seniors qui me seront associés par l’administration.':
      'I am a legal guardian and want access to senior profiles linked to my account by an administrator.',
    'Vérification de la tutelle': 'Guardianship verification',
    'L’accès aux profils seniors sera activé après vérification manuelle par l’administration. Seuls les administrateurs autorisés peuvent consulter ces justificatifs.':
      'Access to senior profiles will be enabled after manual administrator review. Only authorized administrators can view these documents.',
    'Pièce d’identité (PDF, JPEG ou PNG, 10 Mo max.)': 'Identity document (PDF, JPEG, or PNG, 10 MB max.)',
    'Jugement ou attestation officielle de tutelle (PDF, JPEG ou PNG, 10 Mo max.)':
      'Court order or official guardianship certificate (PDF, JPEG, or PNG, 10 MB max.)',
    'Vérification de votre tutelle légale': 'Legal guardianship verification',
    'L’accès aux profils seniors sera activé après validation par l’administration.':
      'Access to senior profiles will be enabled after administrator approval.',
    'Envoyer / remplacer les justificatifs': 'Submit / replace documents',
    'Aucun profil senior associé': 'No senior profile linked',
    'Votre compte est actif, mais l’administration doit associer un ou plusieurs profils seniors avant que vous puissiez consulter leur espace.':
      'Your account is active, but an administrator must link one or more senior profiles before you can access them.',
    'Profil senior associé': 'Linked senior profile',
    'Justificatifs reçus :': 'Documents received:',
    'reçu': 'received',
    'à fournir': 'required',
    'Les justificatifs doivent être complétés. Contactez l’administration après leur remplacement.':
      'Your documents need to be updated. Contact the administrator after replacing them.',
    'Votre dossier est en attente de vérification manuelle. L’accès aux profils seniors sera ouvert après validation.':
      'Your application is awaiting manual review. Access to senior profiles will be enabled after approval.',
    'Ajoutez la pièce d’identité et le justificatif de tutelle avant de créer le compte.':
      'Add your identity document and guardianship proof before creating the account.',
    'Sélectionnez au moins un justificatif de tutelle à envoyer.':
      'Select at least one guardianship document to submit.',
    'Chaque justificatif doit être un PDF, JPEG ou PNG de 10 Mo maximum.':
      'Each document must be a PDF, JPEG, or PNG no larger than 10 MB.',
    'Justificatifs transmis. Votre dossier est en attente de vérification.':
      'Documents submitted. Your application is awaiting review.',
    'Ajoutez votre pièce d’identité et le justificatif officiel de tutelle.':
      'Add your identity document and official guardianship proof.',
    'Compte créé. Votre dossier est en attente de vérification.':
      'Account created. Your application is awaiting review.',
    'Aucun senior associé pour le moment': 'No senior linked yet',
    '✅ Action enregistrée !': '✅ Action saved!',
    'Notifications': 'Notifications',
    'Chargement des notifications…': 'Loading notifications…',
    'Mes préférences de notification': 'My notification preferences',
    'Les SMS et e-mails sont facultatifs. Les messages ne contiennent pas le détail du rendez-vous. Le numéro doit être au format international (+33…).':
      'SMS and email are optional. Messages do not include appointment details. Use international phone format (+33…).',
    'Recevoir les notifications à mon adresse e-mail de connexion': 'Receive notifications at my sign-in email address',
    'Recevoir les notifications par SMS': 'Receive SMS notifications',
    'Enregistrer mes choix SMS et e-mail': 'Save my SMS and email preferences',
    'Activer les notifications push sur cet appareil': 'Enable push notifications on this device',
    'Désactiver les notifications push sur cet appareil': 'Disable push notifications on this device',
    'Clôturer mon compte': 'Close my account',
    'Confirmez avec votre mot de passe': 'Confirm with your password',
    'Demander la clôture': 'Request account closure',
    'Connexion Sécurisée': 'Secure sign-in',
    'Entrez vos identifiants Génération Liaison': 'Enter your Generation Liaison credentials',
    'Après connexion, votre navigateur peut proposer d’enregistrer vos identifiants. Le site ne conserve pas votre mot de passe.':
      'After sign-in, your browser may offer to save your credentials. The site does not store your password.',
    'Afficher': 'Show',
    'Masquer': 'Hide',
    'Afficher le mot de passe': 'Show password',
    'Masquer le mot de passe': 'Hide password',
    'Pas encore de compte ?': 'Don’t have an account yet?',
    'Créer un Compte': 'Create an account',
    'Créez votre accès Génération Liaison': 'Create your Generation Liaison account',
    '👨‍👩‍👧 Proche / Aidant Familial': '👨‍👩‍👧 Family member / Caregiver',
    '👥 Intervenant ou partenaire (soins/services)': '👥 Professional or partner (care/services)',
    '👴 Senior': '👴 Senior',
    'Justificatifs professionnels': 'Professional verification documents',
    'Le compte intervenant reste en attente jusqu’à la vérification manuelle de la pièce d’identité et du Kbis. Fichiers acceptés : PDF, JPEG ou PNG (10 Mo maximum par pièce). Seul l’administrateur peut les consulter.':
      'Professional accounts remain pending until an administrator manually verifies the identity document and company registration (Kbis). Accepted files: PDF, JPEG or PNG (10 MB maximum per file). Only an administrator can view them.',
    'Pièce d’identité': 'Identity document',
    'Kbis': 'Company registration (Kbis)',
    'Notifications e-mail et SMS (facultatives)': 'Email and SMS notifications (optional)',
    'Recevoir les notifications par e-mail': 'Receive email notifications',
    'Zone d’intervention': 'Service area',
    'Rayon d’intervention (km)': 'Service radius (km)',
    'Utiliser ma position actuelle comme domicile': 'Use my current location as my home',
    'Position du domicile non enregistrée.': 'Home location not saved.',
    'J’accepte les': 'I accept the',
    'conditions générales d’utilisation': 'terms of use',
    'et confirme en avoir pris connaissance.': 'and confirm that I have read them.',
    'Lire la politique de confidentialité': 'Read the privacy policy',
    'Veuillez accepter les conditions générales d’utilisation pour créer votre compte.':
      'Please accept the terms of use to create your account.',
    'Créer mon compte': 'Create my account',
    'Déjà inscrit ?': 'Already registered?',
    'Bonjour': 'Hello',
    'Senior': 'Senior',
    'Chargement...': 'Loading...',
    'Besoin d’appeler les secours ?': 'Need emergency help?',
    'Appeler le 15': 'Call 15',
    'Appeler le 112': 'Call 112',
    'Confirmer l’appel': 'Confirm the call',
    'Confirmez une deuxième fois pour préparer l’alerte aux aidants et ouvrir le composeur. Pour confirmer par la voix, dites : « Je confirme l’appel d’urgence ».':
      'Confirm a second time to prepare an alert for caregivers and open the dialer. To confirm by voice, say: “I confirm the emergency call.”',
    'La confirmation vocale dépend du navigateur et peut être traitée par son fournisseur ; Génération Liaison ne conserve pas l’audio. Le bouton de confirmation reste disponible.':
      'Voice confirmation depends on your browser and may be processed by its provider. Generation Liaison does not retain audio. The confirmation button is always available.',
    'Je confirme et continue': 'I confirm and continue',
    'Confirmer par la voix': 'Confirm by voice',
    'Annuler': 'Cancel',
    'Ouvrir le composeur': 'Open the dialer',
    'Comment allez-vous aujourd’hui ?': 'How are you feeling today?',
    'Vous pouvez écrire votre réponse ou la dicter. L’assistant IA vous répondra par écrit ; vous pourrez aussi écouter sa réponse.':
      'You can type or dictate your answer. The AI assistant will reply in writing, and you can also listen to its response.',
    '🔊 Écouter la question': '🔊 Listen to the question',
    'Cette fonction n’est pas un service d’urgence et ne surveille pas votre sécurité. En cas de danger immédiat, appelez le 112 ou le 15.':
      'This feature is not an emergency service and does not monitor your safety. If you are in immediate danger, call 112 or 15.',
    'Votre réponse': 'Your answer',
    '🎙️ Dicter ma réponse': '🎙️ Dictate my answer',
    'La dictée dépend du navigateur et peut être traitée par son fournisseur. L’audio n’est ni conservé par Génération Liaison ni envoyé à OpenAI ; seul le texte que vous soumettez est transmis à OpenAI.':
      'Dictation depends on your browser and may be processed by its provider. Audio is not stored by Generation Liaison or sent to OpenAI; only the text you submit is sent to OpenAI.',
    'Partager votre réponse (facultatif)': 'Share your answer (optional)',
    'Choisissez les aidants autorisés à la lire dans l’application. La réponse de l’IA ne leur est pas transmise.':
      'Choose which caregivers can read it in the app. Your AI response is not shared with them.',
    'Chargement des aidants…': 'Loading caregivers…',
    'Je confirme l’envoi de ma réponse aux aidants sélectionnés.':
      'I confirm that my answer can be sent to the selected caregivers.',
    'Envoyer mon check-in': 'Submit my check-in',
    'Suivi des interventions': 'Visit updates',
    'Consultez les étapes de visite communiquées par vos intervenants.': 'View visit updates shared by your care professionals.',
    'Chargement du suivi…': 'Loading updates…',
    'Transmettre une information à l’équipe': 'Share information with the team',
    'Choisir une équipe autorisée': 'Choose an authorized team',
    '🔵 Information': '🔵 Information',
    '🟠 À suivre': '🟠 Follow-up',
    '🔴 Prioritaire': '🔴 Urgent',
    'Envoyer à l’équipe': 'Send to the team',
    'Un peu de compagnie 🤝': 'A little company 🤝',
    'Chargement de la conversation…': 'Loading conversation…',
    'Votre message': 'Your message',
    'Envoyer': 'Send',
    'Parler à l’équipe': 'Talk to the team',
    'Voir les services et rendez-vous': 'View services and appointments',
    'Chargement des services…': 'Loading services…',
    '📞 APPELER EN VIDÉO': '📞 START VIDEO CALL',
    '➔': '➔',
    '12:00': '12:00',
    '- Livraison du repas': '- Meal delivery',
    'Avez-vous reçu votre repas ?': 'Did you receive your meal?',
    '👍 OUI, reçu': '👍 YES, received',
    '👎 NON, problème': '👎 NO, there is a problem',
    'Se déconnecter': 'Sign out',
    'Suivi de :': 'Updates for:',
    'Check-ins de bien-être partagés': 'Shared wellbeing check-ins',
    'Vous ne voyez ici que les réponses que la personne a choisi de vous transmettre. Ce partage n’est pas un service d’urgence ni une surveillance automatique.':
      'You can only see answers the person has chosen to share with you. This is not an emergency service or automated monitoring.',
    'Chargement des messages partagés…': 'Loading shared messages…',
    '📊 Fil d’actualité en direct': '📊 Live activity feed',
    "📊 Fil d'actualité en direct": '📊 Live activity feed',
    'Chargement du journal...': 'Loading activity…',
    'Les étapes des visites sont visibles si ce compte est autorisé pour le profil concerné.':
      'Visit updates are visible only if this account is authorized for the profile.',
    'Repas, coiffure et ménage à domicile. Cet espace est distinct du suivi des soins et ne transmet aucune donnée médicale aux prestataires. Les demandes doivent être confirmées par le partenaire ; les tarifs et paiements restent à définir.':
      'Meal delivery, hairdressing, and home cleaning. This area is separate from care updates and does not share medical data with providers. Requests must be confirmed by the partner; pricing and payments are still to be defined.',
    'Notifications et demandes à traiter': 'Notifications and requests to review',
    'Vérification de votre dossier intervenant': 'Professional account verification',
    'Votre dossier est en attente de vérification manuelle. L’accès à l’espace intervenant sera ouvert après validation.':
      'Your account is awaiting manual verification. Access to the professional area will be available after approval.',
    'Chargement des justificatifs…': 'Loading verification documents…',
    'Pièce d’identité (PDF, JPEG ou PNG, 10 Mo max.)': 'Identity document (PDF, JPEG or PNG, 10 MB max.)',
    'Kbis (PDF, JPEG ou PNG, 10 Mo max.)': 'Company registration (Kbis) (PDF, JPEG or PNG, 10 MB max.)',
    'Envoyer / remplacer les justificatifs': 'Submit / replace documents',
    'Espaces séparés : soins et services du quotidien': 'Separate areas: care and everyday services',
    'Annuaire national et rendez-vous': 'National directory and appointments',
    'Seuls les intervenants dont le dossier est validé peuvent publier un profil. Votre activité est publique ; votre adresse, votre position et vos coordonnées ne le sont pas. Les demandes sont confirmées par vous.':
      'Only professionals with verified accounts can publish a profile. Your professional details are public; your address, location, and contact details are not. You confirm each request.',
    'Vérification de Google Calendar…': 'Checking Google Calendar…',
    'Connecter mon agenda Google': 'Connect my Google Calendar',
    'Publier mon profil dans l’annuaire': 'Publish my directory profile',
    'Activité professionnelle': 'Professional activity',
    'Présentation publique (facultatif)': 'Public bio (optional)',
    'Photo de profil (URL http(s))': 'Profile photo (http(s) URL)',
    'Aucune photo enregistrée pour l’instant.': 'No photo saved yet.',
    'Durée habituelle du rendez-vous': 'Typical appointment length',
    '15 minutes': '15 minutes',
    '30 minutes': '30 minutes',
    '45 minutes': '45 minutes',
    '1 heure': '1 hour',
    '1 h 30': '1 hr 30 min',
    '2 heures': '2 hours',
    'Fuseau horaire': 'Time zone',
    'Mes horaires de rendez-vous': 'My appointment hours',
    'Les créneaux sont proposés selon ces horaires et les disponibilités réelles de votre agenda Google.':
      'Available times are based on these hours and your actual Google Calendar availability.',
    'Enregistrer mon profil annuaire': 'Save my directory profile',
    'Demandes reçues': 'Received requests',
    'Chargement des demandes…': 'Loading requests…',
    'Suivi de visite uniquement.': 'Visit updates only.',
    'Les étapes et notes pratiques ne constituent pas un dossier médical. N’y saisissez aucune donnée clinique ni information d’urgence.':
      'Updates and practical notes are not a medical record. Do not enter clinical or emergency information here.',
    '← Précédent': '← Previous',
    'Suivant →': 'Next →',
    'Aujourd’hui': 'Today',
    'Visites du jour': 'Today’s visits',
    'Chargement de votre planning…': 'Loading your schedule…',
    'Agenda des services du quotidien': 'Everyday services schedule',
    'Repas, coiffure et ménage : seuls vos rendez-vous vous sont affichés, avec les coordonnées utiles à leur réalisation. Aucun dossier ni renseignement médical n’est accessible ici.':
      'Meals, hairdressing, and cleaning: only your appointments and the contact details needed to complete them are shown. No records or medical information are available here.',
    'Chargement de votre agenda…': 'Loading your schedule…',
    'Mon domicile et mon rayon d’intervention': 'My home and service radius',
    'La position sert uniquement à calculer la distance approximative jusqu’aux rendez-vous qui vous sont affectés. Elle n’est pas communiquée aux seniors ni envoyée à un service cartographique.':
      'Your location is used only to estimate distances to assigned appointments. It is not shared with seniors or sent to a mapping service.',
    'Rayon d’intervention (1 à 500 km)': 'Service radius (1 to 500 km)',
    'Mettre à jour ma position depuis mon domicile': 'Update my location from home',
    'Enregistrer le rayon et la position': 'Save radius and location',
    'Coordination de l’équipe': 'Team coordination',
    'Les coordonnées ne sont accessibles qu’après consentement et uniquement aux intervenants affectés.':
      'Contact details are available only with consent and to assigned professionals.',
    'Ajouter un intervenant déjà inscrit': 'Add a registered professional',
    'Ajouter à l’équipe': 'Add to team',
    'Référencer un partenaire de services': 'Add a service partner',
    'Inscrivez d’abord son compte professionnel dans l’équipe. Les frais (abonnement ou prestation réalisée) seront configurés séparément lorsque les tarifs seront définis.':
      'First add their professional account to the team. Fees (subscription or completed service) will be configured separately once rates are set.',
    'Choisir un intervenant de l’équipe': 'Choose a team professional',
    'Choisir un service': 'Choose a service',
    'Livraison de repas': 'Meal delivery',
    'Coiffure à domicile': 'Home hairdressing',
    'Ménage à domicile': 'Home cleaning',
    'Choisir le modèle de rémunération': 'Choose a payment model',
    'Abonnement (tarif à définir)': 'Subscription (rate to be defined)',
    'Participation après prestation réalisée (tarif à définir)': 'Fee after completed service (rate to be defined)',
    'Ajouter au catalogue': 'Add to directory',
    'Demander le partage à une personne inscrite': 'Request sharing from a registered user',
    'Envoyer la demande de consentement': 'Send consent request',
    'Coordonnées — partage consenti uniquement': 'Contact details — shared with consent only',
    'Choisir une personne autorisée': 'Choose an authorized person',
    'La position GPS sera conservée sur le serveur de l’application pour calculer les distances des intervenants affectés. Elle n’est pas envoyée à un service cartographique et sera effacée si le partage est retiré.':
      'GPS location is stored on the app server to calculate distances for assigned professionals. It is not sent to a mapping service and will be deleted if sharing is withdrawn.',
    'La personne (ou son aidant autorisé) a donné son accord pour enregistrer la position GPS de son domicile.':
      'The person (or their authorized caregiver) has agreed to save their home GPS location.',
    'Relever la position actuelle du domicile': 'Get the current home location',
    'Position GPS non relevée.': 'GPS location not captured.',
    'Enregistrer les coordonnées': 'Save contact details',
    'Planifier une visite': 'Schedule a visit',
    'Choisir un intervenant': 'Choose a professional',
    'Créer la visite': 'Create visit',
    'Les proches ne voient que les étapes et notes pratiques lorsque leur compte est autorisé pour le profil ; les coordonnées ne leur sont pas transmises dans ce suivi.':
      'Family members can see updates and practical notes only when their account is authorized for the profile. Contact details are not shared in these updates.',
    'Annuaire des professionnels': 'Professional directory',
    'Les professionnels dont le dossier est vérifié apparaissent en priorité.':
      'Verified professionals appear first.',
    'Nom, activité ou service': 'Name, profession, or service',
    'Date souhaitée': 'Preferred date',
    'Trier par proximité (position utilisée uniquement pour ce tri)': 'Sort by distance (location used for sorting only)',
    'La recherche nationale fonctionne sans position.': 'National search works without location access.',
    'Rechercher des professionnels': 'Search professionals',
    'Recherchez un professionnel pour voir les profils disponibles.': 'Search for a professional to view available profiles.',
    'Mes demandes de rendez-vous': 'My appointment requests',
    'Chargement de vos demandes…': 'Loading your requests…',
    'Mes contacts': 'My contacts',
    'L’accès à la visio nécessite un abonnement premium actif.': 'Video calls require an active premium subscription.',
    'Chargement des contacts…': 'Loading contacts…',
    'Appel vidéo': 'Video call',
    'Micro': 'Microphone',
    'Caméra': 'Camera',
    'Son': 'Sound',
    'Raccrocher': 'Hang up',
    'Sénior': 'Senior',
    'Aidant': 'Caregiver',
    'Intervenant': 'Professional',
    'Annuaire': 'Directory',
    'Contacts': 'Contacts',
    'Déconnexion': 'Sign out',
    'À confirmer': 'Pending confirmation',
    'Confirmé': 'Confirmed',
    'Réalisé': 'Completed',
    'Annulé': 'Cancelled',
    'Abonnement · tarif à définir': 'Subscription · rate to be defined',
    'Après prestation · tarif à définir': 'After service · rate to be defined',
    'Participation après prestation réalisée · tarif à définir': 'Fee after completed service · rate to be defined',
    'Dossier apparemment simple à examiner': 'Apparently straightforward to review',
    'Données partagées à examiner': 'Shared data to review',
    'Vérifications supplémentaires recommandées': 'Additional checks recommended',
    'Envois de notifications': 'Notification deliveries',
    'Abonnements push': 'Push subscriptions',
    'Réservations annuaire': 'Directory bookings',
    'Traces d’acceptation des conditions': 'Terms acceptance records',
    'Organisations': 'Organizations',
    'Associations aux équipes': 'Team memberships',
    'Partenariats de services': 'Service partnerships',
    'Journal de liaison': 'Activity log',
    'Personnes suivies dans les équipes': 'People supported by teams',
    'Notes partagées': 'Shared notes',
    'Visites': 'Visits',
    'Événements de visite': 'Visit events',
    'Évaluations de visite': 'Visit evaluations',
    'Traces d’accès au suivi': 'Access records for updates',
    'Messages assistant IA': 'AI assistant messages',
    'Désactiver l’assistant IA': 'Disable the AI assistant',
    'Activer l’assistant IA': 'Enable the AI assistant',
    'Médical': 'Medical',
    'Traditionnel': 'Traditional',
    'Plaisir': 'Treat',
    'Données actualisées à': 'Data refreshed at',
    'Agenda du': 'Schedule for',
    'Partenaire mis à jour.': 'Partner updated.',
    'Rendez-vous mis à jour.': 'Appointment updated.',
    'Compte suspendu et sessions fermées.': 'Account suspended and sessions signed out.',
    'Compte réactivé.': 'Account reactivated.',
    'Dossier intervenant validé ; notification mise en file.': 'Professional account approved; notification queued.',
    'Dossier refusé ; notification mise en file.': 'Professional account rejected; notification queued.',
    'Préparation du pré-jugement IA à partir des seuls décomptes…': 'Preparing the AI preliminary assessment from record counts only…',
    'Pré-jugement indicatif prêt. L’administration doit vérifier les données et décider.':
      'Indicative preliminary assessment ready. An administrator must review the data and make the decision.',
    'Effectuez et examinez le pré-jugement IA avant de confirmer la clôture.':
      'Run and review the AI preliminary assessment before confirming account closure.',
    'Ajoutez une note de traitement d’au moins 20 caractères.':
      'Add a processing note of at least 20 characters.',
    'Demande prise en charge.': 'Request is being processed.',
    'Demande clôturée.': 'Request closed.',
    'Chargement du tableau de bord…': 'Loading dashboard…',
    'Impossible de charger le tableau de bord.': 'Unable to load the dashboard.',
    'Assistant IA activé.': 'AI assistant enabled.',
    'Assistant IA désactivé.': 'AI assistant disabled.',
    'Impossible de modifier l’assistant IA.': 'Unable to update the AI assistant.',
    'Impossible d’envoyer la réponse.': 'Unable to send the response.',
    'Rendez-vous modifié.': 'Appointment updated.',
    'Impossible de préparer le pré-jugement IA.': 'Unable to prepare the AI preliminary assessment.',
    'Impossible de mettre à jour la demande.': 'Unable to update the request.',
    'Impossible de traiter le dossier intervenant.': 'Unable to process the professional account.',
    'Impossible de créer le rendez-vous.': 'Unable to create the appointment.',
    'Impossible de modifier le rendez-vous.': 'Unable to update the appointment.',
    'Téléchargement impossible.': 'Download failed.',
    'Téléphone au format +33612345678': 'Phone number in +33612345678 format',
    'Téléphone pour les SMS': 'Phone number for SMS',
    'Adresse e-mail': 'Email address',
    'Mot de passe': 'Password',
    'Mot de passe oublié ?': 'Forgot your password?',
    'Réinitialiser le mot de passe': 'Reset your password',
    'Saisissez l’adresse e-mail de votre compte.': 'Enter your account email address.',
    'Envoyer le lien': 'Send reset link',
    'Nouveau mot de passe': 'New password',
    'Confirmer le nouveau mot de passe': 'Confirm the new password',
    'Enregistrer le mot de passe': 'Save password',
    'Retour à la connexion': 'Back to sign in',
    'Les mots de passe ne correspondent pas.': 'The passwords do not match.',
    'Si un compte actif correspond à cette adresse, un e-mail sera envoyé.': 'If an active account matches this address, an email will be sent.',
    'Votre mot de passe a été modifié. Vous pouvez vous connecter.': 'Your password has been changed. You can now sign in.',
    'Ce lien est invalide ou a expiré. Demandez un nouveau lien.': 'This link is invalid or has expired. Request a new link.',
    'La récupération par e-mail n’est pas encore configurée.': 'Email recovery has not been configured yet.',
    'Impossible de demander la réinitialisation.': 'Unable to request a reset.',
    'Impossible de modifier le mot de passe.': 'Unable to change the password.',
    'Le mot de passe doit contenir au moins 12 caractères.': 'The password must contain at least 12 characters.',
    'Saisissez une adresse e-mail valide.': 'Enter a valid email address.',
    'Serveur inaccessible. Réessayez.': 'Unable to reach the server. Try again.',
    'Prénom et Nom': 'First and last name',
    'Nom du senior suivi': 'Name of the senior you support',
    'Mot de passe (12 caractères min)': 'Password (12 characters minimum)',
    'Écrivez ici comment vous vous sentez...': 'Write how you are feeling here...',
    'Importance de l’information': 'Importance of the information',
    'Information utile pour vos intervenants': 'Information for your care professionals',
    'Information utile pour les intervenants': 'Information for professionals',
    'Ex. aide à domicile, kinésithérapie': 'e.g. home care, physiotherapy',
    'Présentez votre activité, sans coordonnées personnelles': 'Describe your work; do not include personal contact details',
    'https://example.com/photo.jpg': 'https://example.com/photo.jpg',
    'Aperçu de la photo de profil': 'Profile photo preview',
    'Navigation dans l’agenda': 'Schedule navigation',
    'Jour précédent': 'Previous day',
    'Date de l’agenda': 'Schedule date',
    'Jour suivant': 'Next day',
    'E-mail du compte professionnel': 'Professional account email',
    'Nom du partenaire': 'Partner name',
    'Zone d’intervention (facultatif)': 'Service area (optional)',
    'Nom de la personne': 'Person’s name',
    'E-mail du compte senior ou aidant': 'Senior or caregiver account email',
    'Téléphone de la personne': 'Person’s phone number',
    'Adresse': 'Address',
    'Contact d’urgence désigné': 'Designated emergency contact',
    'Téléphone du contact d’urgence': 'Emergency contact phone number',
    'Consignes pratiques (facultatif)': 'Practical instructions (optional)',
    'Type de visite': 'Visit type',
    'Ex. aide à domicile': 'e.g. home care',
    'Appuyez sur le micro pour dicter votre compte-rendu de visite :':
      'Tap the microphone to dictate your visit report:',
    'Texte dicté :': 'Dictated text:',
    'Le compte-rendu apparaîtra ici automatiquement lors de votre dictée...':
      'Your visit report will appear here as you dictate...',
    'Valider et envoyer à la famille': 'Submit and send to the family',
    'Visite chez': 'Visit with',
    'Suivi et logistique pour :': 'Updates and coordination for:',
    '📊 Carnet de liaison en temps réel': '📊 Live activity log',
    "📊 Carnet de liaison en temps réel": '📊 Live activity log',
    "Chargement du fil d'actualité...": 'Loading activity feed...',
    '🍲 Commander un repas chez notre partenaire': '🍲 Order a meal from our partner',
    'Chargement des menus...': 'Loading menus...',
    '🛒 Commande envoyée au prestataire !': '🛒 Order sent to the provider!',
    'Commander': 'Order',
    'Code secret d’administration': 'Administrator access code',
    'Code confidentiel d’au moins 32 caractères, configuré sur le serveur.':
      'Confidential code of at least 32 characters, configured on the server.',
    '← Retour au site': '← Back to website',
    'Actualiser': 'Refresh',
    'Vue d’ensemble': 'Overview',
    'Gérez les comptes et les services du quotidien depuis votre ordinateur.':
      'Manage accounts and everyday services from your computer.',
    'Données protégées :': 'Protected data:',
    'cet espace ne présente ni notes de soins, ni transmissions médicales, ni contacts d’urgence, ni adresses ou téléphones des clients. Pour les demandes de clôture, l’IA reçoit uniquement le rôle, la catégorie de formule et des décomptes de dossiers ; elle donne un pré-jugement indicatif, jamais une décision. L’administration vérifie les dossiers réels et confirme seule la clôture.':
      'this area does not display care notes, medical updates, emergency contacts, or client addresses or phone numbers. For account-closure requests, AI receives only the role, subscription category, and record counts; it provides an indicative preliminary assessment, never a decision. An administrator reviews the actual records and makes the final decision.',
    'Indicateurs': 'Statistics',
    'Partenaires des services du quotidien': 'Everyday service partners',
    'Activation et formule de rémunération. Les tarifs restent à définir.':
      'Activation and payment model. Rates are still to be defined.',
    'Partenaire': 'Partner',
    'Service': 'Service',
    'Équipe': 'Team',
    'Zone': 'Area',
    'Demandes': 'Requests',
    'Rémunération': 'Payment',
    'Accès': 'Access',
    'Action': 'Action',
    'Demandes et rendez-vous de services': 'Service requests and appointments',
    'Les coordonnées du client ne sont pas affichées dans cet espace.':
      'Client contact details are not displayed in this area.',
    'Date': 'Date',
    'Client': 'Client',
    'Service / partenaire': 'Service / partner',
    'Organisation': 'Organization',
    'Statut': 'Status',
    'Rendez-vous d’accompagnement': 'Care appointments',
    'Chaque création ou modification demande l’accord de l’intervenant avant son ajout aux agendas. Aucun compte-rendu ni note de soins.':
      'The professional must approve each new or changed appointment before it is added to calendars. No reports or care notes are shown.',
    'Choisir une personne': 'Choose a person',
    'Date et heure': 'Date and time',
    'Durée en minutes': 'Duration in minutes',
    'Créer le rendez-vous': 'Create appointment',
    'Date / heure': 'Date / time',
    'Personne': 'Person',
    'Type': 'Type',
    'Signalements rouges après intervention': 'Urgent reports after a visit',
    'À examiner par l’administration. Les signalements rouges déclenchent également une notification aux comptes administrateurs configurés.':
      'For administrator review. Urgent reports also trigger a notification to configured administrator accounts.',
    'Chargement des signalements…': 'Loading reports…',
    'Assistant IA et demandes de contact': 'AI assistant and contact requests',
    'L’interrupteur désactive ou réactive l’assistant pour tous les seniors. Seuls les administrateurs autorisés voient les demandes de contact humain.':
      'This switch enables or disables the assistant for all seniors. Only authorized administrators can view requests to speak with a person.',
    'Chargement…': 'Loading…',
    'Chargement des demandes de contact…': 'Loading contact requests…',
    'Comptes': 'Accounts',
    'Les nouveaux intervenants restent en attente jusqu’à la vérification de leur pièce d’identité et de leur Kbis. Les justificatifs sont privés et réservés à l’administration.':
      'New professionals remain pending until their identity document and company registration (Kbis) are verified. Verification documents are private and available only to administrators.',
    'Nom': 'Name',
    'E-mail': 'Email',
    'Rôle': 'Role',
    'Profil': 'Profile',
    'Équipes': 'Teams',
    'Créé le': 'Created',
    'Dossier intervenant': 'Professional documents',
    'Vérification et profils seniors': 'Verification and senior profiles',
    'Tuteur légal': 'Legal guardian',
    'Validé': 'Verified',
    'À compléter': 'Needs attention',
    'En attente': 'Pending',
    'Identité': 'Identity',
    'Tutelle': 'Guardianship',
    'Télécharger': 'Download',
    'Manquant': 'Missing',
    'Valider la tutelle': 'Approve guardianship',
    'Refuser': 'Reject',
    'Retirer': 'Remove',
    'Choisir un profil senior': 'Choose a senior profile',
    'Associer': 'Link',
    'Associer un profil senior au compte aidant': 'Link a senior profile to this caregiver account',
    'Vérifiez la tutelle avant d’associer des seniors.':
      'Verify guardianship before linking senior profiles.',
    'Tutelle vérifiée.': 'Guardianship verified.',
    'Justificatifs de tutelle refusés.': 'Guardianship documents rejected.',
    'Profil senior associé au compte aidant.': 'Senior profile linked to caregiver account.',
    'Profil senior retiré du compte aidant.': 'Senior profile removed from caregiver account.',
    'Les justificatifs de vérification et de tutelle sont accessibles uniquement aux administrateurs.':
      'Verification and guardianship documents are available only to administrators.',
    'Demandes de clôture et d’effacement': 'Account closure and deletion requests',
    'Demande reçue': 'Request received',
    'Échéance (30 jours)': 'Due date (30 days)',
    'Compte': 'Account',
    'État': 'State',
    'Pré-jugement IA et inventaire': 'AI preliminary assessment and inventory',
    'Actions': 'Actions',
    'Personne accompagnée': 'Person receiving care',
    'Type de rendez-vous': 'Appointment type',
    'Connectez-vous avec un compte autorisé par l’administrateur du serveur.':
      'Sign in with an account authorized by the server administrator.',
    'Retour': 'Back'
  };

  let language = 'fr';
  try {
    const storedLanguage = window.localStorage.getItem(storageKey);
    if (storedLanguage === 'fr' || storedLanguage === 'en') language = storedLanguage;
  } catch (error) {
    console.warn('Unable to read the saved language preference.', error);
  }

  const textNodes = [];
  const attributes = [];

  function normalize(value) {
    return value.trim().replace(/\s+/g, ' ');
  }

  function translated(value) {
    if (language !== 'en') return value;
    const leading = value.match(/^\s*/)[0];
    const trailing = value.match(/\s*$/)[0];
    const key = normalize(value);
    return Object.prototype.hasOwnProperty.call(translations, key)
      ? `${leading}${translations[key]}${trailing}`
      : value;
  }

  function applyTranslations() {
    for (const entry of textNodes) entry.node.textContent = translated(entry.original);
    for (const entry of attributes) entry.element.setAttribute(entry.name, translated(entry.original));
  }

  function setLanguage(nextLanguage) {
    if (nextLanguage !== 'fr' && nextLanguage !== 'en') {
      throw new TypeError('Language must be "fr" or "en".');
    }

    language = nextLanguage;
    document.documentElement.lang = language;
    try {
      window.localStorage.setItem(storageKey, language);
    } catch (error) {
      console.warn('Unable to save the language preference.', error);
    }

    applyTranslations();
    window.dispatchEvent(new CustomEvent('generationliaisonlanguagechange', {
      detail: { language }
    }));
  }

  window.generationLiaisonTranslate = translated;
  window.generationLiaisonLocale = () => language === 'en' ? 'en-US' : 'fr-FR';
  window.generationLiaisonSetLanguage = setLanguage;

  document.addEventListener('DOMContentLoaded', () => {
    const control = document.createElement('label');
    control.className = 'gl-language-switch';

    const label = document.createElement('span');
    label.textContent = 'Langue';

    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Langue');
    select.innerHTML = '<option value="fr">Français</option><option value="en">English</option>';
    select.value = language;
    select.addEventListener('change', () => setLanguage(select.value));

    control.append(label, select);
    document.body.insertBefore(control, document.body.firstChild);

    const style = document.createElement('style');
    style.textContent = `
      .gl-language-switch {
        position: relative;
        z-index: 30;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        min-height: 46px;
        padding: 6px 12px;
        color: #334155;
        font: 14px/1.3 Arial, sans-serif;
      }
      .gl-language-switch select {
        min-height: 32px;
        padding: 4px 8px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        background: #fff;
        color: inherit;
        font: inherit;
      }
      .gl-language-switch select:focus-visible {
        outline: 2px solid #2563eb;
        outline-offset: 2px;
      }
      .gl-password-field {
        display: flex;
        align-items: stretch;
        gap: 6px;
        width: 100%;
        margin-bottom: 15px;
      }
      .gl-password-field input {
        flex: 1;
        min-width: 0;
        width: 100%;
        margin-bottom: 0;
      }
      .gl-password-toggle {
        flex: 0 0 auto;
        min-height: 44px;
        padding: 8px 10px;
        border: 1px solid #64748b;
        border-radius: 8px;
        background: #fff;
        color: #1f2937;
        font: inherit;
        white-space: nowrap;
        cursor: pointer;
      }
      .gl-password-toggle:focus-visible {
        outline: 2px solid #2563eb;
        outline-offset: 2px;
      }
    `;
    document.head.append(style);

    const passwordToggles = [];
    for (const input of document.querySelectorAll('input[type="password"]')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'gl-password-field';
      input.before(wrapper);
      wrapper.append(input);

      const toggle = document.createElement('button');
      toggle.className = 'gl-password-toggle';
      toggle.type = 'button';
      toggle.textContent = translated('Afficher');
      toggle.setAttribute('aria-label', translated('Afficher le mot de passe'));
      toggle.setAttribute('aria-pressed', 'false');
      toggle.addEventListener('click', () => {
        const isVisible = input.type === 'text';
        input.type = isVisible ? 'password' : 'text';
        toggle.textContent = translated(isVisible ? 'Afficher' : 'Masquer');
        toggle.setAttribute(
          'aria-label',
          translated(isVisible ? 'Afficher le mot de passe' : 'Masquer le mot de passe')
        );
        toggle.setAttribute('aria-pressed', String(!isVisible));
      });
      wrapper.append(toggle);
      passwordToggles.push({ input, toggle });
    }

    window.addEventListener('generationliaisonlanguagechange', () => {
      for (const { input, toggle } of passwordToggles) {
        const isVisible = input.type === 'text';
        toggle.textContent = translated(isVisible ? 'Masquer' : 'Afficher');
        toggle.setAttribute(
          'aria-label',
          translated(isVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe')
        );
      }
    });

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.parentElement.closest('script, style, textarea, code, pre')) {
        textNodes.push({ node, original: node.textContent });
      }
    }

    for (const element of document.body.querySelectorAll('[placeholder], [aria-label], [title], [alt]')) {
      for (const name of ['placeholder', 'aria-label', 'title', 'alt']) {
        if (element.hasAttribute(name)) {
          attributes.push({ element, name, original: element.getAttribute(name) });
        }
      }
    }

    applyTranslations();
  }, { once: true });
})();
