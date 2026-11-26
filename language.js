(() => {
  const storageKey = 'generation-liaison-language';
  const translations = {
    'Lier mon compte à un aidant': 'Connect my account to a caregiver',
    'Un aidant peut demander à vous rejoindre. Vérifiez son identité, puis acceptez ou refusez sa demande.': 'A caregiver can ask to connect with you. Check their identity, then accept or decline their request.',
    'Voir les demandes des aidants': 'See caregiver requests',
    'Lier mon compte à une personne accompagnée': 'Connect my account to a person receiving support',
    'Si vous n’êtes pas tuteur légal, demandez l’accès avec son adresse e-mail. Votre demande marque votre accord ; la personne doit ensuite l’accepter pour lier vos comptes. Les tuteurs légaux doivent contacter l’administration.': 'If you are not a legal guardian, request access using their email address. Your request shows your agreement; the person must then accept it to connect your accounts. Legal guardians must contact the administration.',
    'Demandes d’accès des aidants': 'Caregiver access requests',
    'Le senior peut normalement accepter lui-même. En cas d’oubli, confirmez uniquement après avoir vérifié son accord directement auprès de lui. Cette action ne donne pas accès à ses contenus privés à l’administration.': 'The person can normally accept the request themselves. If they forget, confirm only after checking their agreement directly with them. This does not give administrators access to private content.',
    'Aucune demande d’accès en cours.': 'No pending access requests.',
    'Comment avez-vous vérifié l’accord du senior ?': 'How did you verify the person’s agreement?',
    'Indiquez le mode de vérification, sans donnée de santé ni information privée (20 caractères minimum).': 'Describe how you verified it, without health or private information (at least 20 characters).',
    ' Je confirme avoir vérifié l’accord du senior.': ' I confirm that I verified the person’s agreement.',
    'Confirmer à la place du senior': 'Confirm on the person’s behalf',
    'Confirmer cet accès après avoir vérifié l’accord du senior ?': 'Confirm this access after verifying the person’s agreement?',
    'Accord confirmé et accès activé.': 'Agreement confirmed and access activated.',
    'Impossible de confirmer la demande.': 'Unable to confirm the request.',
    'Impossible de charger les demandes d’accès.': 'Unable to load access requests.',
    'Découvrir la présentation': 'Explore the overview',
    'Messages aux inscrits': 'Messages to registered users',
    'Destinataires': 'Recipients',
    'Titre': 'Title',
    'Message': 'Message',
    'Envoyer la notification': 'Send notification',
    'Tous les comptes actifs': 'All active accounts',
    'Personnes accompagnées / seniors': 'People receiving support / seniors',
    'Proches / aidants': 'Family / caregivers',
    'Professionnels / intervenants': 'Professionals / service providers',
    'Soignants en établissement': 'Facility care staff',
    'Tous les comptes rattachés': 'All linked accounts',
    'Messages de l’équipe et de l’établissement': 'Messages from the team and the facility',
    'Marquer comme lu': 'Mark as read',
    'Votre établissement': 'Your facility',
    'Tableau chiffré': 'Summary figures',
    'Comptes actifs': 'Active accounts',
    'Coordonnées saisies': 'Contact records',
    'Non disponible': 'Not available',
    'Les comptes actifs et les coordonnées saisies sont comptés séparément ; une même personne peut apparaître dans les deux colonnes.': 'Active accounts and contact records are counted separately; the same person may appear in both columns.',
    'Type de compte': 'Account type',
    'Votre établissement crée votre compte soignant. Pour une connexion sans e-mail, demandez-lui le lien et vos identifiants.': 'Your facility creates your care staff account. To sign in without an email address, ask your facility for the link and your credentials.',
    'Présentations': 'Overviews',
    'Proches': 'Family and caregivers',
    'Entreprises et résidences': 'Businesses and residences',
    'Personnes accompagnées': 'People receiving support',
    'Lors de l’inscription, choisissez « Personne accompagnée ».': 'When registering, choose “Person receiving support”.',
    'Lors de l’inscription, choisissez « Proche / Aidant Familial ».': 'When registering, choose “Family caregiver”.',
    'Lors de l’inscription, choisissez « Intervenant ou partenaire ».': 'When registering, choose “Professional or partner”.',
    'Lors de l’inscription, choisissez « Entreprise / résidence ».': 'When registering, choose “Business / residence”.',
    'Rester entouré au quotidien': 'Stay connected every day',
    'Une interface simple': 'A simple interface',
    'La vue simplifiée est activée par défaut. Retrouvez vos messages, contacts et rendez-vous ; les jeux et les autres fonctions sont accessibles en affichant toutes les fonctions dans les réglages.': 'Simplified view is enabled by default. Find your messages, contacts and appointments; games and other features are accessible by showing all features in settings.',
    'Choisir les personnes autorisées': 'Choose authorized people',
    'Vous acceptez les demandes de vos proches. Le partage du carnet de l’établissement avec les soignants demande votre accord ou celui de votre représentant légal vérifié.': 'You accept requests from your family and caregivers. Sharing the residence journal with care staff requires your consent or that of your verified legal representative.',
    'Un carnet pour la vie quotidienne': 'A journal for everyday life',
    'Partagez des nouvelles du quotidien avec les personnes autorisées. Le carnet n’est pas destiné aux informations de santé.': 'Share everyday updates with authorized people. The journal is not intended for health information.',
    'Génération Liaison ne remplace ni un dossier médical ni un service d’urgence. En cas d’urgence en France, appelez le 15 ou le 112.': 'Génération Liaison does not replace a medical record or an emergency service. In an emergency in France, call 15 or 112.',
    'Retour à l’accueil': 'Back to home',
    'Tarifs et conditions': 'Pricing and terms',
    'Garder le lien, même à distance': 'Stay connected, even from a distance',
    'Partager des nouvelles': 'Share updates',
    'Selon vos autorisations, consultez et écrivez dans le carnet, échangez des messages et retrouvez les informations utiles du quotidien.': 'Depending on your permissions, read and write in the journal, exchange messages and find useful daily information.',
    'Organiser le quotidien': 'Organize daily life',
    'Retrouvez les rendez-vous accessibles et gérez les tâches partagées avec la personne accompagnée et les intervenants concernés.': 'Find appointments you can access and manage tasks shared with the person receiving support and the relevant professionals.',
    'Respecter le choix de votre proche': 'Respect your loved one’s choice',
    'La personne accompagnée accepte les demandes d’association. Un représentant légal vérifié peut être associé par l’administration ; l’association ne donne pas automatiquement accès aux autres proches.': 'The person receiving support accepts connection requests. A verified legal representative can be linked by the administration; this does not automatically grant access to other relatives.',
    'Le carnet de l’établissement est destiné aux nouvelles du quotidien, pas aux informations de santé. En cas d’urgence en France, appelez le 15 ou le 112.': 'The residence journal is intended for everyday updates, not health information. In an emergency in France, call 15 or 112.',
    'Pour les intervenants et services à domicile': 'For professionals and home services',
    'Coordonner ses interventions': 'Coordinate your visits',
    'Rendez-vous et tâches': 'Appointments and tasks',
    'Retrouvez vos rendez-vous et les tâches qui vous sont attribuées, selon les autorisations accordées. Une notification dans l’application vous informe lorsqu’une tâche vous est confiée.': 'Find your appointments and assigned tasks, according to your permissions. An in-app notification informs you when a task is assigned to you.',
    'Nouvelle tâche confiée': 'New task assigned',
    'Une tâche vous a été confiée. Consultez votre espace intervenant.': 'A task has been assigned to you. Check your professional workspace.',
    'Chacun peut se proposer ou attribuer une tâche à une personne associée ou à un intervenant enregistré dans l’annuaire partagé. L’intervenant reçoit une notification dans l’application ; pour une autre personne, prévenez-la. L’attribution ne confirme pas son accord. Vous pouvez libérer une tâche si nécessaire.': 'Anyone can volunteer or assign a task to a linked person or a professional saved in the shared directory. Professionals receive an in-app notification; notify other people yourself. Assignment does not confirm their agreement. You can release a task if needed.',
    'Vous pouvez vous proposer ou attribuer une tâche à une personne associée ou à un intervenant enregistré dans l’annuaire partagé. L’intervenant reçoit une notification dans l’application ; pour une autre personne, prévenez-la. L’attribution ne confirme pas son accord. Vous pouvez libérer une tâche confiée à un intervenant.': 'You can volunteer or assign a task to a linked person or a professional saved in the shared directory. Professionals receive an in-app notification; notify other people yourself. Assignment does not confirm their agreement. You can release a task assigned to a professional.',
    'Ajoutez d’abord l’intervenant à l’annuaire partagé. Il reçoit une notification dans l’application ; prévenez les autres personnes.': 'First add the professional to the shared directory. They receive an in-app notification; notify other people yourself.',
    'Présenter son activité': 'Present your services',
    'Après validation de votre dossier, vous pouvez publier votre activité dans l’annuaire et gérer les demandes de rendez-vous selon vos disponibilités.': 'Once your application is approved, you can publish your services in the directory and manage appointment requests according to your availability.',
    'Vérification et confidentialité': 'Verification and privacy',
    'Les nouveaux comptes intervenants sont vérifiés par l’administration. Les échanges et accès restent limités aux personnes autorisées.': 'New professional accounts are reviewed by the administration. Exchanges and access remain limited to authorized people.',
    'Génération Liaison facilite l’organisation du quotidien et ne remplace pas un service d’urgence. En cas d’urgence en France, appelez le 15 ou le 112.': 'Génération Liaison helps organize daily life and does not replace an emergency service. In an emergency in France, call 15 or 112.',
    'Gérer les accès': 'Manage access',
    'Retrouvez les résidents, soignants et intervenants dans trois tableaux distincts. Avec leur accord, créez des comptes individuels pour les résidents et soignants, même sans e-mail.': 'Find residents, care staff and professionals in three separate tables. With their consent, create individual accounts for residents and care staff, even without email.',
    'Un carnet partagé avec accord': 'A journal shared with consent',
    'Le résident ou son représentant légal vérifié décide du partage avec les soignants de l’établissement. La direction ne consulte ni les carnets ni les messages privés. Le carnet concerne les nouvelles du quotidien, pas les données de santé.': 'The resident or their verified legal representative decides whether to share with the residence’s care staff. Management cannot read journals or private messages. The journal is for daily updates, not health data.',
    'Abonnement et tarifs': 'Subscription and pricing',
    'Accès et tarifs': 'Access and pricing',
    'L’accès de l’établissement est activé manuellement. L’application est gratuite. La partie médicale est payante ; ses tarifs et modalités restent à préciser. Aucun paiement en ligne ni facturation automatique n’est actuellement proposé.': 'Organization access is activated manually. The app is free. The medical section is paid; its prices and terms remain to be determined. Online payments and automatic invoicing are not currently available.',
    'Créer un compte': 'Create an account',
    'Avec l’accord de la personne, créez un nouveau compte. Elle reçoit un e-mail pour choisir elle-même son mot de passe et accepter les conditions. Cette création ne donne pas accès à ses contenus privés.': 'With the person’s agreement, create a new account. They receive an email to choose their own password and accept the terms. Creating the account does not grant access to their private content.',
    'Type de compte': 'Account type',
    'Proche / aidant': 'Relative / caregiver',
    'Je confirme l’accord de la personne.': 'I confirm the person has agreed.',
    'Compte créé. Un lien d’activation a été envoyé à la personne.': 'Account created. An activation link has been sent to the person.',
    'Compte créé, mais l’e-mail n’a pas pu être envoyé. Après une minute, demandez à la personne de créer son mot de passe avec « Mot de passe oublié » sur la page de connexion.': 'Account created, but the email could not be sent. After one minute, ask the person to set their password using “Forgot password” on the sign-in page.',
    'Abonnement dans Entreprises / résidences.': 'Subscription in Businesses / residences.',
    'Pour activer votre compte, acceptez les conditions générales d’utilisation en vigueur.': 'To activate your account, accept the current terms of use.',
    'Connexion résident ou soignant sans e-mail': 'Resident or care worker sign-in without email',
    'Copiez ce lien et transmettez-le à la personne concernée. Elle pourra l’ouvrir sur son appareil et se connecter avec ses propres identifiants. Sur un appareil partagé, déconnectez d’abord le compte directeur.': 'Copy this link and send it to the person concerned. They can open it on their device and sign in with their own credentials. On a shared device, first sign out of the director account.',
    'Lien de connexion': 'Sign-in link',
    'Copier le lien de connexion': 'Copy sign-in link',
    'Lien copié. Transmettez-le à la personne concernée.': 'Link copied. Send it to the person concerned.',
    'Copie automatique impossible : copiez le lien sélectionné.': 'Automatic copying failed: copy the selected link.',
    'Réglages d’affichage': 'Display settings',
    'Utiliser l’affichage standard': 'Use standard display',
    'La vue simplifiée est activée par défaut sur cet appareil et pour ce compte.': 'Simplified view is enabled by default on this device for this account.',
    'La vue simplifiée est activée par défaut sur cet appareil et pour ce compte. Vous pouvez afficher toutes les fonctions à tout moment.':
      'Simplified view is enabled by default on this device for this account. You can show all features at any time.',
    'La vue simplifiée est activée par défaut sur cet appareil et pour ce compte. Elle agrandit les éléments sans retirer de fonctions.':
      'Simplified view is enabled by default on this device for this account. It enlarges elements without removing features.',
    'Capture en français de la vue simplifiée activée par défaut, avec des données fictives.':
      'French screenshot of the simplified view enabled by default, using fictional data.',
    'Accédez à vos messages, vos prochains rendez-vous et vos jeux gratuits depuis une interface claire. La vue simplifiée est activée par défaut ; vous pouvez afficher toutes les fonctions dans les réglages.':
      'Access messages, upcoming appointments and free games in a clear interface. Simplified view is enabled by default; you can show all features in settings.',
    'À qui s’adresse Génération Liaison ?': 'Who is Génération Liaison for?',
    'Voir les aperçus de l’interface senior': 'View the senior interface previews',
    'Informations sur les prestataires': 'Information about service providers',
    'Comment accéder à l’application ?': 'How to access the application',
    'Aide et informations légales': 'Help and legal information',
    'Informations sur les tableaux': 'About the tables',
    'Informations sur le carnet et les messages': 'About the journal and messages',
    'Informations sur les espaces': 'About the workspaces',
    'Choisissez votre espace': 'Choose your workspace',
    'Senior et personne accompagnée': 'Older adults and people receiving support',
    'Gardez le lien avec vos proches, retrouvez vos rendez-vous et profitez de jeux dans une interface simple.': 'Stay in touch with loved ones, find your appointments and enjoy games in a simple interface.',
    'Proches et aidants': 'Family and caregivers',
    'Partagez des nouvelles et organisez le quotidien avec votre proche, selon vos autorisations.': 'Share updates and organize daily life with your loved one, according to your permissions.',
    'Professionnels et intervenants': 'Professionals and service providers',
    'Organisez vos interventions, retrouvez vos rendez-vous et échangez avec les personnes autorisées.': 'Organize your visits, find your appointments and communicate with authorized people.',
    'Gérez les accès des résidents et des soignants et retrouvez les intervenants de votre établissement.': 'Manage resident and care staff access and find your establishment’s service providers.',
    'Soignants en établissement': 'Care staff in an establishment',
    'Partagez des nouvelles du quotidien avec les résidents et leurs proches autorisés.': 'Share daily updates with residents and their authorized family members.',
    'Votre établissement crée votre compte individuel. Pour une connexion sans e-mail, rapprochez-vous de votre établissement.': 'Your establishment creates your individual account. Contact your establishment to sign in without email.',
    'Le carnet concerne les nouvelles du quotidien, pas les données de santé. Le partage avec les soignants nécessite l’accord du résident ou de son représentant légal vérifié.': 'The journal is for daily updates, not health data. Sharing with care staff requires consent from the resident or their verified legal representative.',
    'Toutes les informations sur Génération Liaison': 'All information about Génération Liaison',
    'Informations': 'Information',
    'Espaces séparés : soins et services du quotidien.': 'Separate workspaces: care and daily services.',
    'Comprendre les espaces': 'Understanding the workspaces',
    'Les soins et les services du quotidien disposent d’espaces séparés.': 'Care and daily services have separate workspaces.',
    'Les proches autorisés à accéder au profil peuvent voir les étapes et les notes pratiques. Les coordonnées ne leur sont pas transmises dans ce suivi.': 'Family members authorized to access the profile can see visit steps and practical notes. Contact details are not shared with them in these updates.',
    'Mes tâches confiées': 'Tasks assigned to me',
    'Retrouvez ici les tâches qui vous ont été attribuées et indiquez quand elles sont terminées. Leur attribution ne remplace pas votre accord sur la prestation.': 'Find tasks assigned to you here and mark them when completed. Assignment does not replace your agreement to provide the service.',
    'Un carnet de liaison pour les proches, les intervenants et les établissements': 'A shared journal for families, professionals and organizations',
    'Pour les seniors et toute personne ayant besoin d’accompagnement au quotidien, notamment en situation de handicap : partagez les nouvelles et organisez les visites avec les personnes autorisées, à domicile comme en résidence.':
      'For older adults and anyone who needs daily support, including people with disabilities: share updates and organize visits with authorized people, at home or in a residence.',
    'Découvrir l’espace entreprises et résidences': 'Explore the business and residence workspace',
    'La personne accompagnée accepte les demandes des aidants ; un tuteur légal vérifié est associé par l’administration. Le partage avec les soignants de l’établissement nécessite l’accord du résident ou de son représentant légal vérifié. Le carnet sert aux nouvelles du quotidien, pas aux données de santé.':
      'The person receiving support accepts caregivers’ requests; a verified legal guardian is linked by the administration. Sharing with the organization’s care staff requires consent from the resident or their verified legal representative. The journal is for daily updates, not health data.',
    'Un espace pour les personnes accompagnées, leurs proches et les professionnels': 'A workspace for people receiving support, their families and professionals',
    'Pour les entreprises et résidences': 'For businesses and residences',
    'Un espace dédié à la direction': 'A dedicated manager workspace',
    'Retrouvez les résidents, soignants et intervenants dans des tableaux séparés, et gérez les comptes individuels des résidents et des soignants.':
      'Find residents, care staff and service providers in separate tables and manage individual resident and staff accounts.',
    'Entreprises et résidences : un espace pour la direction': 'Businesses and residences: a workspace for managers',
    'Organisez les accès de votre établissement et gardez le lien avec les résidents et leurs proches, dans le respect des autorisations de chacun.':
      'Organize your organization’s access and stay in touch with residents and their families while respecting everyone’s permissions.',
    'Les trois tableaux de l’espace directeur': 'The three tables in the manager workspace',
    'Résidents': 'Residents',
    'Soignants': 'Care staff',
    'Intervenants': 'Service providers',
    'Avec leur accord, créez leurs accès individuels, même sans adresse e-mail.': 'With their consent, create individual access even without an email address.',
    'Créez leurs comptes et gérez leurs accès à l’établissement.': 'Create their accounts and manage their organization access.',
    'Retrouvez leurs coordonnées dans un tableau distinct.': 'Find their contact details in a separate table.',
    'Le résident ou son représentant légal vérifié choisit le partage du carnet de liaison avec les soignants. La direction ne consulte pas les carnets ni les messages privés. Le carnet est réservé aux nouvelles du quotidien, sans données de santé.':
      'The resident or their verified legal representative decides whether to share the journal with care staff. Management cannot view journals or private messages. The journal is for daily updates, not health data.',
    'L’accès de l’établissement est activé manuellement par l’administration. Les options de tablettes sont indicatives ; aucun paiement en ligne n’est effectué.':
      'Organization access is activated manually by the administration. Tablet options are indicative; no online payment is taken.',
    'Créer un compte établissement': 'Create an organization account',
    'Lors de l’inscription, choisissez « Entreprise / résidence ».': 'When registering, choose “Business / residence”.',
    '🏢 Entreprise / résidence': '🏢 Business / residence',
    'Entreprise / résidence': 'Business / residence',
    'Espace Directeur · Entreprise / Résidence': 'Manager workspace · business / residence',
    'Présentation de l’établissement': 'Organization profile',
    'Nom de l’établissement': 'Organization name',
    'Présentation': 'Description',
    'Adresse': 'Address',
    'Téléphone': 'Phone',
    'E-mail de contact': 'Contact email',
    'Option tablettes (facultatif)': 'Tablet option (optional)',
    'Aucune demande': 'No request',
    'Location envisagée : 25 € HT / mois / tablette sur 12 mois + Premium à venir': 'Possible rental: €25 excluding tax / month / tablet over 12 months + future Premium',
    'Achat envisagé : 299 € TTC / tablette': 'Possible purchase: €299 including tax / tablet',
    'Nombre de tablettes souhaitées': 'Number of tablets requested',
    'Tarifs indicatifs, selon devis et disponibilité. La location prévoit un engagement de 12 mois et le service Premium en supplément, dont le tarif reste à définir. Le Premium n’est pas encore disponible et aucun partenaire de location n’est confirmé. Ce choix exprime un intérêt et ne constitue ni une commande ni un engagement.':
      'Indicative prices, subject to a quote and availability. Rental involves a 12-month commitment and Premium service at an additional price yet to be determined. Premium is not yet available and no rental partner has been confirmed. This expresses interest and is neither an order nor a commitment.',
    'Résidents et soignants': 'Residents and caregivers',
    'Catégorie': 'Category',
    'Résident': 'Resident',
    'Soignant': 'Caregiver',
    'Enregistrer les coordonnées': 'Save contact details',
    'Annuler la modification': 'Cancel editing',
    'Actualiser la fiche': 'Refresh profile',
    'Demander la clôture': 'Request account closure',
    'Coordonnées privées du compte directeur. Ne saisissez aucune information médicale. Assurez-vous d’être autorisé à enregistrer ces informations et informez les personnes concernées. Ces fiches ne créent pas de comptes et ne donnent aucun accès aux dossiers.':
      'These contact details are private to the manager account. Do not enter medical information. Ensure you are authorized to record the details and inform the people concerned. These entries do not create accounts or grant access to records.',
    'Explications du journal du quotidien': 'Daily journal help',
    'Retrouvez les nouvelles et étapes des jours précédents. Les informations du jour apparaissent dans « Aujourd’hui ».':
      'Find updates and visit stages from previous days. Today’s information appears in “Today”.',
    'Retrouvez les étapes d’intervention, y compris celles du jour, et les nouvelles des jours précédents.':
      'Find visit stages, including today’s, and updates from previous days.',
    'Retrouvez les étapes des visites à la date sélectionnée dans l’agenda.':
      'Find visit stages for the date selected in the calendar.',
    'Ce journal ne surveille pas votre sécurité.': 'This journal does not monitor your safety.',
    'Ce journal ne surveille pas la sécurité de la personne accompagnée.': 'This journal does not monitor the safety of the person receiving support.',
    'Avant d’imprimer, vérifiez le contenu : le papier peut être lu par d’autres personnes.':
      'Before printing, check the contents: other people may read the paper copy.',
    'Suivi des collègues limité aux 100 dernières étapes sur 30 jours et 100 visites entre 30 jours avant et 30 jours après aujourd’hui. Une visite terminée ne précise pas les tâches réalisées. Ce journal ne remplace pas un dossier médical.':
      'Colleague updates are limited to the last 100 stages over 30 days and 100 visits between 30 days before and 30 days after today. A completed visit does not specify the tasks performed. This journal does not replace a medical record.',
    'Afficher les nouvelles plus anciennes': 'Show older updates',
    'Impossible de charger les nouvelles plus anciennes. Réessayez.': 'Unable to load older updates. Please try again.',
    'Archive des nouvelles et des étapes d’interventions de la veille et des jours précédents. Les informations du jour apparaissent dans « Aujourd’hui » puis sont conservées ici dès le lendemain. Le nom de l’auteur est indiqué lorsqu’il est disponible ; sinon, seul son rôle apparaît. Ce journal ne surveille pas votre sécurité.':
      'An archive of updates and visit stages from yesterday and earlier. Today’s information appears in “Today” and is kept here from the next day. The author’s name is shown when available; otherwise only their role is shown. This journal does not monitor your safety.',
    'Les étapes d’intervention apparaissent ici dès aujourd’hui et restent dans le journal. Les nouvelles de la veille et des jours précédents sont également conservées ici. Le nom de l’auteur est indiqué lorsqu’il est disponible ; sinon, seul son rôle apparaît. Ce journal ne surveille pas la sécurité de la personne accompagnée.':
      'Visit stages appear here from today and remain in the journal. Updates from previous days are also kept here. The author’s name is shown when available; otherwise only their role is shown. This journal does not monitor the safety of the person receiving support.',
    '🧑 Personne accompagnée': '🧑 Person receiving support',
    'Personne accompagnée': 'Person receiving support',
    'Nom de la personne accompagnée (facultatif)': 'Name of the person receiving support (optional)',
    'Vous pouvez créer votre compte même si la personne accompagnée n’est pas encore inscrite. Le suivi apparaîtra lorsqu’elle rejoindra l’application et partagera son profil.':
      'You can create your account even if the person receiving support has not registered yet. Updates will appear when they join the app and share their profile.',
    'Je suis tuteur légal et souhaite accéder aux profils des personnes accompagnées qui me seront associés par l’administration.':
      'I am a legal guardian and wish to access the profiles of people receiving support that the administration links to me.',
    'Si vous êtes un proche et le représentant légal d’une personne qui ne peut plus gérer son compte, cochez cette case. Après vérification des justificatifs, l’administration peut associer votre compte au profil concerné. Cet accès ne donne pas automatiquement accès aux autres proches.':
      'If you are a loved one and the legal representative of a person who can no longer manage their account, check this box. After verifying the documents, the administration can link your account to the relevant profile. This does not automatically grant access to other loved ones.',
    'L’accès aux profils des personnes accompagnées sera activé après vérification manuelle par l’administration. Seuls les administrateurs autorisés peuvent consulter ces justificatifs.':
      'Access to the profiles of people receiving support will be enabled after manual verification by the administration. Only authorized administrators can view these documents.',
    'L’accès aux profils des personnes accompagnées sera activé après validation par l’administration.':
      'Access to the profiles of people receiving support will be enabled after approval by the administration.',
    'Aucune personne accompagnée associée': 'No person receiving support is linked',
    'Aucun profil n’est disponible. Demandez l’accès à une personne accompagnée ou contactez l’administration si vous êtes tuteur légal.':
      'No profile is available. Request access to a person receiving support or contact the administration if you are a legal guardian.',
    'Actualiser les profils': 'Refresh profiles',
    'Gérer mes profils accompagnés': 'Manage my linked profiles',
    'Mes profils accompagnés': 'My linked profiles',
    'Saisissez l’adresse e-mail de la personne accompagnée pour lui envoyer une invitation à découvrir l’application. Si elle ne possède pas encore de compte, faites une nouvelle demande après son inscription. Elle devra l’accepter avant que vous puissiez consulter son profil.':
      'Enter the email address of the person receiving support to invite them to discover the app. If they do not have an account yet, make a new request after they register. They must accept it before you can view their profile.',
    'Adresse e-mail de la personne accompagnée': 'Email address of the person receiving support',
    'Pour un tuteur légal, l’administration vérifie les justificatifs et associe le profil de la personne accompagnée à son compte. Les autres proches n’obtiennent pas automatiquement l’accès.':
      'For a legal guardian, the administration verifies the documents and links the profile of the person receiving support to their account. Other loved ones do not automatically gain access.',
    'Profils accompagnés indisponibles': 'Linked profiles unavailable',
    'Impossible de charger les profils accompagnés. Vérifiez votre connexion et réessayez.':
      'Unable to load linked profiles. Check your connection and try again.',
    'Aucune personne accompagnée associée pour le moment': 'No person receiving support is linked yet',
    'Ces contacts sont visibles et modifiables par la personne accompagnée et tous ses aidants associés. Vérifiez régulièrement les numéros. En cas d’urgence, appelez le 15 ou le 112.':
      'These contacts can be viewed and edited by the person receiving support and all their linked caregivers. Check the numbers regularly. In an emergency, call 15 or 112.',
    'Ces tâches sont visibles et modifiables par la personne accompagnée et tous ses aidants associés. Un intervenant ne voit que les tâches que vous lui attribuez depuis l’annuaire partagé. Évitez les informations médicales.':
      'These tasks can be viewed and edited by the person receiving support and all their linked caregivers. A professional sees only tasks assigned to them from the shared directory. Avoid medical information.',
    'La personne accompagnée doit accepter chaque photo proposée avant son partage avec les aidants associés. Les photos peuvent contenir des informations de localisation.':
      'The person receiving support must accept each proposed photo before it is shared with linked caregivers. Photos may contain location information.',
    'Proposer la photo à la personne accompagnée': 'Propose the photo to the person receiving support',
    'Les étapes d’intervention apparaissent ici dès aujourd’hui et restent dans le journal. Les nouvelles de la veille et des jours précédents sont également conservées ici. Ce journal ne surveille pas la sécurité de la personne accompagnée.':
      'Visit updates appear here from today and remain in the journal. Updates from previous days are also kept here. This journal does not monitor the safety of the person receiving support.',
    'Aucune personne accompagnée pour le moment : les rendez-vous apparaîtront ici dès qu’une personne sera associée à votre compte.':
      'No person receiving support yet: appointments will appear here once a person is linked to your account.',
    'Votre dossier est en attente de vérification manuelle. L’accès aux profils des personnes accompagnées sera ouvert après validation.':
      'Your application is awaiting manual verification. Access to the profiles of people receiving support will open after approval.',
    'Que vous soyez senior ou que vous ayez besoin d’accompagnement pour une autre raison, choisissez le profil « Personne accompagnée » dans l’application.':
      'Whether you are an older adult or need support for another reason, choose the “Person receiving support” profile in the app.',
    'Le carnet de liaison simple pour les personnes accompagnées et leurs proches':
      'The simple shared journal for people receiving support and their loved ones',
    'Pour les seniors et toute personne ayant besoin d’accompagnement au quotidien, notamment en situation de handicap : coordonnez les visites, partagez les nouvelles et retrouvez les services à domicile, même à distance.':
      'For older adults and anyone who needs everyday support, including people with disabilities: coordinate visits, share updates and find home services, even from a distance.',
    'La personne accompagnée accepte les demandes des aidants ; un tuteur légal vérifié est associé par l’administration. Génération Liaison facilite l’organisation du quotidien et ne remplace pas un dossier médical. Certaines transmissions professionnelles sont enregistrées dans l’espace prévu à cet effet.':
      'The person receiving support accepts caregivers’ requests; a verified legal guardian is linked by the administration. Génération Liaison helps organize daily life and does not replace a medical record. Some professional care updates are recorded in the designated space.',
    'Pour les personnes accompagnées': 'For people receiving support',
    'Que vous soyez senior ou que vous ayez besoin d’accompagnement pour une autre raison, votre espace est appelé « senior » dans l’application.':
      'Whether you are an older adult or need support for another reason, your space is called “senior” in the app.',
    'Consultez le carnet de liaison partagé, recevez des notifications utiles et organisez les visites autour de votre proche, selon vos accès.':
      'View the shared journal, receive useful notifications and organize visits for your loved one, according to your access.',
    'Mon proche n’est pas à l’aise avec Internet, comment faire ?': 'My loved one is not comfortable with the internet. What can we do?',
    'Plusieurs proches peuvent demander l’accès : la personne accompagnée doit accepter chaque demande. Il n’y a pas de plafond fixe dans l’application ; un message groupé peut être envoyé à 20 correspondants au maximum.':
      'Several loved ones can request access: the person receiving support must accept each request. There is no fixed limit in the app; a group message can be sent to up to 20 contacts.',
    'Gestion des cookies': 'Cookie settings',
    'Le lien au quotidien entre générations': 'Connecting generations every day',
    'Le carnet de liaison numérique simple et rassurant pour les seniors et leurs proches':
      'The simple, reassuring digital journal for older adults and their loved ones',
    'Coordonnez les visites, partagez les nouvelles du quotidien et retrouvez les services à domicile au même endroit. Une interface pensée pour la sérénité des familles et l’autonomie des aînés, même à distance.':
      'Coordinate visits, share daily updates and find home services in one place. An interface designed for families’ peace of mind and older adults’ independence, even from a distance.',
    '✓ Application gratuite · ✓ Aucun suivi statistique dans l’espace connecté · ✓ Accessible sans installation':
      '✓ Free app · ✓ No analytics tracking in signed-in areas · ✓ Accessible without installation',
    'Une tablette : achat ou location': 'A tablet: purchase or rental',
    'Découvrir l’achat ou la location d’une tablette': 'Discover tablet purchase or rental',
    'Achat envisagé à 299 € TTC, ou location envisagée à 25 € HT par mois sur 12 mois, avec Premium en supplément. Le tarif Premium reste à définir.':
      'Proposed purchase for €299 including tax, or rental for €25 excluding tax per month over 12 months, with Premium at an additional cost. Premium pricing is yet to be determined.',
    'Ces prix sont indicatifs, sous réserve de devis et de disponibilité. Aucun partenaire de location n’est confirmé. Indiquer votre intérêt ne constitue ni une commande ni un paiement.':
      'These prices are indicative, subject to a quote and availability. No rental partner has been confirmed. Expressing interest does not place an order or make a payment.',
    'Indiquer mon intérêt pour une tablette': 'Express interest in a tablet',
    'Vos échanges restent privés et sécurisés': 'Your conversations remain private and secure',
    'Aucun outil statistique ou publicitaire n’est installé dans les espaces connectés. Avant validation d’un compte professionnel, l’administration examine la pièce d’identité et le Kbis.':
      'No analytics or advertising tools are installed in signed-in areas. Before approving a professional account, the administration reviews identification and the Kbis business registration document.',
    'Bon à savoir : Génération Liaison facilite l’organisation de la vie sociale et du quotidien. Il ne remplace ni un dossier médical ni un service d’urgence. En cas d’urgence en France, composez le 15 ou le 112.':
      'Good to know: Génération Liaison helps organize social and everyday life. It does not replace a medical record or an emergency service. In an emergency in France, call 15 or 112.',
    'Un espace pensé pour toute la famille et les intervenants du quotidien': 'A space designed for the whole family and everyday professionals',
    'Restez entouré en toute simplicité': 'Stay connected with ease',
    'Accédez à vos messages, vos prochains rendez-vous et vos jeux gratuits depuis une interface claire. Activez la vue simplifiée en un clic pour profiter de boutons larges et lisibles, sans réglages complexes.':
      'Access your messages, upcoming appointments and free games in a clear interface. Turn on the simplified view in one click for large, readable buttons without complicated settings.',
    'Gardez l’esprit léger, même à distance': 'Enjoy peace of mind, even from a distance',
    'Consultez le carnet de liaison partagé, recevez des notifications utiles et organisez les visites autour de votre parent, selon vos accès.':
      'View the shared journal, receive useful notifications and organize visits for your parent, according to your access.',
    'Valorisez vos interventions à domicile': 'Make the most of your home visits',
    'Coiffeurs, aides ménagères ou prestataires de services : confirmez vos passages, échangez avec les personnes autorisées et simplifiez la gestion de vos rendez-vous auprès des familles.':
      'Hairdressers, home helpers and other service providers: confirm your visits, communicate with authorized people and simplify appointment management with families.',
    'Tout le quotidien réuni dans un seul carnet': 'Everything you need for daily life in one journal',
    'Notez les petits événements de la journée, les promenades prévues ou les passages à domicile. Les personnes autorisées retrouvent les informations partagées dans leur carnet.':
      'Record the day’s small events, planned walks or home visits. Authorized people can find shared information in their journal.',
    'Visualisez les rendez-vous à venir et découvrez des services de confort à domicile, comme la coiffure, pour faciliter la vie de tous les jours.':
      'See upcoming appointments and discover home comfort services, such as hairdressing, to make everyday life easier.',
    'Choisissez les alertes qui comptent pour vous et laissez-vous guider dans l’application grâce à l’assistant intégré.':
      'Choose the alerts that matter to you and let the built-in assistant guide you through the app.',
    'Une application gratuite': 'A free application',
    'Les tarifs futurs sont à l’étude et ne sont pas appliqués. Toute formule payante future fera l’objet d’une information claire et préalable.':
      'Future prices are under consideration and are not currently applied. Any future paid plan will be clearly communicated in advance.',
    'Vos questions, nos réponses': 'Your questions, our answers',
    'Un proche peut l’aider à créer son compte, activer la vue simplifiée et ajouter le site à l’écran d’accueil de son téléphone ou de sa tablette. L’application fonctionne dans un navigateur et nécessite une connexion Internet.':
      'A family member can help them create an account, enable the simplified view and add the site to their phone or tablet home screen. The app works in a browser and requires an internet connection.',
    'Faut-il télécharger une application sur téléphone ?': 'Do I need to download an app on my phone?',
    'Non, Génération Liaison fonctionne directement dans un navigateur Internet. Sur Android, une application est aussi disponible au téléchargement. Sur iPhone, utilisez « Partager » dans Safari puis « Ajouter à l’écran d’accueil ».':
      'No, Génération Liaison works directly in a web browser. An Android app is also available to download. On iPhone, use “Share” in Safari, then “Add to Home Screen”.',
    'Comment sont sélectionnés les prestataires à domicile ?': 'How are home service providers selected?',
    'Avant d’activer un compte professionnel, l’administration examine la pièce d’identité et le Kbis de l’intervenant. Demandez un devis et une attestation d’assurance au professionnel avant votre premier rendez-vous.':
      'Before activating a professional account, the administration reviews the provider’s identification and Kbis business registration document. Ask the professional for a quote and proof of insurance before your first appointment.',
    'Une question ou besoin d’aide pour démarrer ? Écrivez-nous à': 'A question or need help getting started? Write to us at',
    'Projet de tarifs et CGV': 'Draft prices and terms of sale',
    'Politique de confidentialité': 'Privacy policy',
    'Choix des cookies': 'Cookie choices',
    'Mesure de fréquentation': 'Audience measurement',
    'Avec votre accord, Google Analytics mesure les visites de cette page. Des cookies et des données techniques, dont votre adresse IP, sont transmis à Google. Aucun suivi n’est installé dans les espaces connectés. Vous pouvez refuser ou changer votre choix à tout moment.':
      'With your consent, Google Analytics measures visits to this page. Cookies and technical data, including your IP address, are sent to Google. No tracking is installed in signed-in areas. You can refuse or change your choice at any time.',
    'En savoir plus': 'Learn more',
    'Impossible d’enregistrer votre choix sur cet appareil. La mesure est désactivée.':
      'Unable to save your choice on this device. Measurement is disabled.',
    'Effacez les données du site dans votre navigateur pour retirer un accord enregistré précédemment.':
      'Clear the site data in your browser to withdraw any previously saved consent.',
    'Génération Liaison': 'Génération Liaison',
    'Confidentialité, RGPD et données de santé': 'Privacy, GDPR and health data',
    'La connexion au site est chiffrée et l’accès au carnet est réservé aux personnes autorisées.':
      'The connection to the site is encrypted, and access to the journal is limited to authorized people.',
    'Le senior accepte les demandes des aidants ; un tuteur légal vérifié est associé par l’administration. Génération Liaison facilite l’organisation du quotidien et ne remplace pas un dossier médical. Certaines transmissions professionnelles sont enregistrées dans l’espace prévu à cet effet.':
      'The senior accepts caregivers’ requests; a verified legal guardian is linked by the administration. Génération Liaison helps organize daily life and does not replace a medical record. Some professional care updates are recorded in the designated space.',
    'Selon la documentation de Render, les bases PostgreSQL et leurs sauvegardes sont chiffrées au repos (AES-256). La région utilisée pour cette application n’a pas été vérifiée dans le compte d’hébergement. Aucune certification HDS n’est revendiquée. Ces informations ne constituent pas une garantie de conformité HDS ; l’application facilite l’organisation du quotidien et ne remplace pas un dossier médical. Certaines fonctions permettent toutefois des transmissions professionnelles de soin. N’y ajoutez pas d’autres données de santé tant que les conditions d’hébergement et les obligations applicables ne sont pas confirmées. Voir la':
      'According to Render documentation, PostgreSQL databases and their backups are encrypted at rest (AES-256). The region used for this application has not been verified in the hosting account. No HDS certification is claimed. This information does not guarantee HDS compliance; the app helps organize daily life and does not replace a medical record. Some features nevertheless allow professional care updates. Do not add other health data until hosting conditions and applicable obligations have been confirmed. See the',
    'documentation de Render sur PostgreSQL': 'Render PostgreSQL documentation',
    'Vous pouvez demander l’accès à vos données, leur rectification ou leur effacement. Consultez la':
      'You can request access to, correction or deletion of your data. Read the',
    'politique de confidentialité': 'privacy policy',
    'pour connaître vos droits et les prestataires concernés.': 'to learn about your rights and the providers involved.',
    'Météo': 'Weather',
    'Brocantes et vide-greniers': 'Flea markets and garage sales',
    'Consultez les événements près de chez vous sur Vide-greniers.org.': 'Find events near you on Vide-greniers.org.',
    'Ouvrir Vide-greniers.org (site externe)': 'Open Vide-greniers.org (external site)',
    'Choisissez votre commune pour voir la météo.': 'Choose your municipality to see the weather.',
    'Voir les prévisions de la semaine': 'See the weekly forecast',
    'Choisir ou changer ma commune': 'Choose or change my municipality',
    'Ville ou code postal français': 'French city or postal code',
    'La recherche utilise le service public des communes. Votre choix est enregistré sur cet appareil et ses coordonnées approximatives sont envoyées à Visual Crossing pour les prévisions. Aucun GPS n’est utilisé.':
      'The search uses the public municipality service. Your choice is saved on this device and its approximate coordinates are sent to Visual Crossing for forecasts. GPS is not used.',
    'Rechercher': 'Search',
    'Choisissez votre commune': 'Choose your municipality',
    'Afficher la météo': 'Show weather',
    'Utiliser la commune du compte': 'Use the account municipality',
    'Commune du compte (obligatoire)': 'Account municipality (required)',
    'Code postal français': 'French postal code',
    'Saisissez au moins la ville ou le code postal.': 'Enter at least a city or postal code.',
    'La météo est activée par défaut sur cet appareil. La commune du compte ou celle choisie est utilisée pour les prévisions.':
      'Weather is enabled by default on this device. The account municipality or your chosen municipality is used for forecasts.',
    'Afficher la météo sur l’accueil': 'Show weather on the home screen',
    'Impossible d’enregistrer le réglage météo sur cet appareil.': 'Unable to save the weather setting on this device.',
    'Cette commune sera utilisée par défaut pour la météo. Sa recherche utilise le service public des communes et son centre approximatif sera transmis à Visual Crossing pour les prévisions. Aucun GPS n’est utilisé. Vous pourrez choisir une autre commune ou désactiver la météo sur votre appareil.':
      'This municipality will be used by default for weather. Its search uses the public municipality service and its approximate center will be sent to Visual Crossing for forecasts. GPS is not used. You can choose another municipality or disable weather on your device.',
    'Prévisions fournies par': 'Forecasts provided by',
    'Les prévisions peuvent être inexactes ou indisponibles. Consultez les alertes officielles pour votre sécurité.':
      'Forecasts may be inaccurate or unavailable. Check official alerts for your safety.',
    'Impossible de lire la commune enregistrée. Choisissez-la à nouveau.': 'Unable to read the saved municipality. Please choose it again.',
    'La météo est momentanément indisponible. Réessayez plus tard.': 'Weather is temporarily unavailable. Please try again later.',
    'La météo n’est pas encore configurée.': 'Weather is not configured yet.',
    'Trop de demandes météo. Réessayez dans une minute.': 'Too many weather requests. Please try again in a minute.',
    'Recherche de la commune…': 'Searching for the municipality…',
    'Plusieurs communes trouvées. Choisissez la vôtre.': 'Several municipalities found. Please choose yours.',
    'Le service de recherche des communes est indisponible.': 'The municipality search service is unavailable.',
    'Aucune commune trouvée avec cette ville et ce code postal.': 'No municipality found for this city and postal code.',
    'Saisissez une ville ou un code postal.': 'Enter a city or postal code.',
    'Choisissez une commune dans la liste.': 'Choose a municipality from the list.',
    'Impossible d’enregistrer la commune sur cet appareil.': 'Unable to save the municipality on this device.',
    'Impossible de supprimer la commune enregistrée sur cet appareil.': 'Unable to remove the municipality saved on this device.',
    'ciel dégagé': 'clear skies',
    'ciel nuageux': 'cloudy',
    'brouillard': 'fog',
    'bruine': 'drizzle',
    'pluie': 'rain',
    'neige': 'snow',
    'orage': 'thunderstorms',
    'conditions indisponibles': 'conditions unavailable',
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
    'Coordination et sérénité entre seniors, proches et professionnels.':
      'Coordination and peace of mind for seniors, families and professionals.',
    'Pour les familles et les aidants : gardez le lien avec votre parent, retrouvez les nouvelles et les rendez-vous, et découvrez les services à domicile, même à distance.':
      'For families and caregivers: stay connected with your parent, find updates and appointments, and discover home services, even from a distance.',
    'Créer un espace gratuitement': 'Create a free space',
    'Voir un exemple de carnet': 'See an example journal',
    'Un espace simple pour garder le lien et organiser le quotidien avec vos proches.':
      'A simple space to stay connected and organize everyday life with your loved ones.',
    'Pour les familles et les aidants : gardez le lien avec votre parent et organisez ensemble son quotidien, même à distance.':
      'For families and caregivers: stay connected with your parent and organize their daily life together, even from a distance.',
    'Retrouvez les rendez-vous et découvrez des services pour faciliter le quotidien, distincts du suivi des soins.':
      'Find appointments and discover everyday services, separate from care coordination.',
    'Retrouvez les rendez-vous et découvrez des services pour faciliter le quotidien, indépendants du suivi médical.':
      'Find appointments and discover everyday services, independent of medical care.',
    'Choisissez vos notifications et laissez-vous guider dans l’application par l’assistant.':
      'Choose your notifications and let the assistant guide you through the app.',
    'Les informations du jour': 'Today’s information',
    'Dans « Aujourd’hui », retrouvez les informations accessibles à votre compte, comme les rendez-vous, les tâches et les messages, présentées en bulles colorées.':
      'In “Today”, find the information available to your account, such as appointments, tasks and messages, displayed in colorful bubbles.',
    'Le senior et ses aidants associés peuvent préparer des tâches et les attribuer à un intervenant enregistré dans leur annuaire partagé. L’intervenant reçoit une notification dans l’application, ne voit que les tâches qui lui sont confiées et peut indiquer qu’elles sont terminées. L’attribution ne vaut pas accord de sa part.':
      'The senior and their linked caregivers can prepare tasks and assign them to a professional saved in their shared directory. The professional receives an in-app notification, sees only tasks assigned to them and can mark them as completed. Assignment does not imply their agreement.',
    'Liste de courses': 'Shopping list',
    'Le senior peut enregistrer une liste de courses privée et, s’il le souhaite, en envoyer une copie par message aux personnes choisies. Une copie envoyée ne se met pas à jour automatiquement.':
      'The senior can save a private shopping list and choose to send a copy by message to selected people. A sent copy does not update automatically.',
    'Découvrez des services du quotidien, comme la coiffure à domicile, distincts du suivi des soins.':
      'Discover everyday services, such as hairdressing at home, separate from care coordination.',
    'Découvrez des services du quotidien, comme la coiffure à domicile, indépendants du suivi médical.':
      'Discover everyday services, such as hairdressing at home, independent of medical care.',
    'Garder le lien au quotidien': 'Stay connected every day',
    'Une femme sourit en tenant les mains d’une personne âgée, près d’un autre proche.':
      'A woman smiles while holding an older person’s hands, with another loved one nearby.',
    'Partagez des nouvelles et organisez les visites avec vos proches et les intervenants concernés.':
      'Share updates and organize visits with your loved ones and the professionals involved.',
    'Questions fréquentes': 'Frequently asked questions',
    'L’application est gratuite. La partie médicale est payante ; ses tarifs et modalités restent à préciser. Aucun paiement n’est actuellement activé dans l’application.':
      'The app is free. The medical section is paid; its prices and terms remain to be determined. No payment is currently enabled in the app.',
    'Les prestations à domicile sont indépendantes de l’application et peuvent être facturées par le prestataire.':
      'Home services are independent of the app and may be charged by the provider.',
    'La messagerie est gratuite. Pour échanger avec un contact, ajoutez-vous mutuellement, sauf si vous êtes déjà associés comme senior et aidant. Pour une urgence, appelez les secours.':
      'Messaging is free. To exchange messages with a contact, add each other unless you are already linked as senior and caregiver. In an emergency, call the emergency services.',
    'La visio est gratuite, sous réserve de disponibilité du service.': 'Video calls are free, subject to service availability.',
    'La visio est gratuite.': 'Video calls are free.',
    'Gratuité et partie médicale': 'Free access and the medical section',
    'Toute formule payante fera l’objet d’une information claire et préalable.': 'Any paid plan will be clearly explained in advance.',
    'D’autres jeux pourront être ajoutés ultérieurement.': 'More games may be added later.',
    'Pour échanger des messages, ajoutez-vous mutuellement dans vos contacts, sauf si vous êtes déjà associés comme senior et aidant.':
      'To exchange messages, add each other as contacts unless you are already linked as senior and caregiver.',
    'Retrouver le site sur l’écran d’accueil': 'Find the site on your home screen',
    'Sans télécharger de fichier, vous pouvez ajouter un raccourci sur votre téléphone. Les menus et leurs noms peuvent varier selon le navigateur.':
      'You can add a shortcut to your phone without downloading a file. Menus and their names may vary by browser.',
    '1. Ouvrez le site': '1. Open the site',
    'Sur votre téléphone, ouvrez Génération Liaison dans votre navigateur.': 'On your phone, open Génération Liaison in your browser.',
    'Sur iPhone : ajouter le site à l’écran d’accueil': 'On iPhone: add the website to your home screen',
    'Ce raccourci ouvre le site : il ne s’agit pas d’une application téléchargée. Les menus peuvent varier selon la version d’iOS.':
      'This shortcut opens the website; it is not a downloaded app. Menus may vary depending on the iOS version.',
    '1. Ouvrez Safari': '1. Open Safari',
    'Sur votre iPhone, ouvrez Génération Liaison dans Safari.': 'On your iPhone, open Génération Liaison in Safari.',
    '2. Touchez Partager': '2. Tap Share',
    'Touchez le bouton Partager : le carré avec une flèche vers le haut.': 'Tap the Share button: the square with an upward arrow.',
    'Choisissez « Ajouter à l’écran d’accueil », puis touchez « Ajouter ». Faites défiler le menu si nécessaire.':
      'Choose “Add to Home Screen”, then tap “Add”. Scroll through the menu if necessary.',
    'Sur Android, vous pouvez aussi utiliser le menu à trois points de votre navigateur pour ajouter le site à l’écran d’accueil, ou télécharger l’application ci-dessous.':
      'On Android, you can also use your browser’s three-dot menu to add the website to your home screen, or download the app below.',
    'Sur iPhone, utilisez le site dans Safari : aucune application iOS native n’est proposée. Vous pouvez ajouter un raccourci à l’écran d’accueil en suivant les étapes ci-dessous.':
      'On iPhone, use the website in Safari: no native iOS app is offered. You can add a home screen shortcut by following the steps below.',
    '2. Ouvrez le menu': '2. Open the menu',
    'Sur Android, touchez les trois points du navigateur. Sur iPhone, dans Safari, touchez le bouton Partager (carré avec une flèche).':
      'On Android, tap the three dots in the browser. On iPhone, in Safari, tap the Share button (a square with an arrow).',
    '3. Ajoutez le raccourci': '3. Add the shortcut',
    'Choisissez « Ajouter à l’écran d’accueil » ou « Installer l’application », puis confirmez si demandé.':
      'Choose “Add to Home Screen” or “Install app”, then confirm if prompted.',
    'Créer un carnet gratuitement': 'Create a free journal',
    'Combien ça coûte ?': 'How much does it cost?',
    'Les tarifs futurs sont à l’étude et ne sont pas appliqués.':
      'Future prices are under consideration and are not currently applied.',
    'Consulter le projet de tarifs et les conditions de vente': 'View the draft prices and terms of sale',
    'Mon parent n’est pas à l’aise avec Internet, comment faire ?': 'My parent is not comfortable with the internet. What can we do?',
    'Un proche peut l’aider à créer son compte et à ajouter le site à l’écran d’accueil de son téléphone. L’application fonctionne dans un navigateur et nécessite une connexion Internet.':
      'A family member can help them create an account and add the site to their phone’s home screen. The app works in a browser and requires an internet connection.',
    'Combien de proches peut-on associer à un carnet ?': 'How many family members can be linked to a journal?',
    'Plusieurs proches peuvent demander l’accès : le senior doit accepter chaque demande. Il n’y a pas de plafond fixe dans l’application ; un message groupé peut être envoyé à 20 correspondants au maximum.':
      'Several family members can request access: the senior must accept each request. There is no fixed limit in the app; a group message can be sent to up to 20 contacts.',
    'Un espace simple pour faciliter les échanges entre les seniors, leurs proches et les professionnels, avec un accès séparé aux services du quotidien.':
      'A simple space for seniors, their families, and professionals to stay connected, with separate access to everyday services.',
    'Suivi partagé': 'Shared updates',
    'Carnet de liaison': 'Activity log',
    'Exemple fictif de carnet de liaison': 'Fictional example of a shared journal',
    'Exemple de carnet de liaison': 'Shared journal example',
    'Votre message': 'Your message',
    'Les réponses de l’assistant peuvent être imprécises ou incomplètes ; elles ne remplacent pas un avis professionnel.':
      'The assistant’s answers may be imprecise or incomplete; they do not replace professional advice.',
    'Un proche · Aujourd’hui à 9 h 30': 'Family member · Today at 9:30 AM',
    'La promenade de cet après-midi est prévue avec un proche.': 'A walk is planned with a family member this afternoon.',
    'Un intervenant à domicile · Aujourd’hui à 8 h 15': 'Home support worker · Today at 8:15 AM',
    'Espace Proche de l’interface senior : boutons Notifications et messages, Contacts et Jeux gratuits.':
      'Family section of the senior interface: Notifications and messages, Contacts and Free games buttons.',
    'Capture en français de l’espace Proche de l’interface senior.':
      'Screenshot in French of the family section of the senior interface.',
    'Voir aussi la vue simplifiée': 'See the simplified view too',
    'Capture en français de la vue simplifiée facultative, avec des données fictives.':
      'Screenshot in French of the optional simplified view, with fictional data.',
    'Accueil senior en vue simplifiée : notifications et messages, journal, rendez-vous et contacts.':
      'Senior home screen in simplified view: notifications and messages, journal, appointments and contacts.',
    'Les services disponibles dépendent des équipes associées et de leur disponibilité. Avant validation d’un compte professionnel, l’administration examine la pièce d’identité et le Kbis.':
      'Available services depend on associated teams and their availability. Before approving a professional account, the administration reviews identification and the Kbis business registration document.',
    'L’assurance et la qualité des prestations ne sont pas vérifiées par l’application. Demandez les justificatifs et un devis au prestataire avant de vous engager.':
      'The app does not verify insurance or service quality. Ask the provider for supporting documents and a quote before committing.',
    'Le prochain rendez-vous est confirmé.': 'The next appointment is confirmed.',
    'Un aperçu du carnet de liaison avec des données fictives.':
      'A preview of the activity log with fictional data.',
    'Alertes et assistance': 'Alerts and support',
    'Services du quotidien': 'Everyday services',
    'Tâches du quotidien': 'Everyday tasks',
    'Aperçu des informations accessibles pour ce proche et des rendez-vous visibles dans votre agenda. Les messages et notifications concernent tous vos contacts. Ce tableau ne surveille pas la sécurité de la personne.':
      'Overview of information accessible for this person and appointments visible in your calendar. Messages and notifications concern all your contacts. This overview does not monitor anyone’s safety.',
    'Aperçu des informations accessibles à votre compte.': 'Overview of information accessible to your account.',
    'Demandes de rendez-vous en attente': 'Pending appointment requests',
    'Impossible de charger les demandes de rendez-vous.': 'Unable to load appointment requests.',
    'Voici les nouvelles disponibles dans l’application. Ce tableau ne surveille pas votre sécurité.':
      'Here are the updates available in the app. This overview does not monitor your safety.',
    'Plus de nouvelles': 'More updates',
    'Rendez-vous aujourd’hui': 'Appointments today',
    'Autres rendez-vous': 'Other appointments',
    'Tâches à faire': 'Tasks to do',
    'Pour aujourd’hui': 'Due today',
    'Pour aujourd’hui ou en retard': 'Due today or overdue',
    'Messages non lus': 'Unread messages',
    'Notifications non lues parmi les 50 dernières': 'Unread notifications among the latest 50',
    '50 dernières notifications — pour répondre, ouvrez Notifications et messages': 'Latest 50 notifications — open Notifications and messages to respond',
    'Impossible de charger les notifications.': 'Unable to load notifications.',
    'Interventions du jour ou actualisées aujourd’hui': 'Visits today or updated today',
    'Dernière étape': 'Latest update',
    'Étapes du jour': 'Today’s updates',
    'Collègue': 'Colleague',
    'Moi': 'Me',
    'Prévue le': 'Scheduled for',
    'Visite prévue, non confirmée terminée': 'Visit scheduled, not confirmed complete',
    'Visite signalée en cours': 'Visit reported in progress',
    'Visite signalée terminée': 'Visit reported complete',
    'Impossible de charger le suivi des interventions.': 'Unable to load visit updates.',
    'Services du jour': 'Services today',
    'En attente de réponse': 'Awaiting a response',
    'Annulés': 'Cancelled',
    'Impossible de charger les services.': 'Unable to load services.',
    'Nouvelles du jour dans les 100 dernières': 'Today’s updates among the latest 100',
    'Dernière nouvelle': 'Latest update',
    'Impossible de charger le fil d’actualité.': 'Unable to load the activity feed.',
    'Nouvelles de bien-être partagées aujourd’hui (30 dernières)': 'Wellbeing updates shared today (latest 30)',
    'Impossible de charger les nouvelles de bien-être.': 'Unable to load wellbeing updates.',
    'Prochain rendez-vous aujourd’hui': 'Next appointment today',
    'Aucun rendez-vous à venir aujourd’hui.': 'No more appointments today.',
    'Impossible de charger les rendez-vous.': 'Unable to load appointments.',
    'Tâches à faire aujourd’hui ou en retard': 'Tasks due today or overdue',
    'Sans volontaire': 'Unclaimed',
    'Messages non lus (tous vos contacts)': 'Unread messages (all your contacts)',
    'Chargement des messages…': 'Loading messages…',
    'Les conversations n’ont pas pu être chargées.': 'Conversations could not be loaded.',
    'Les messages automatiques n’ont pas pu être chargés.': 'Automatic messages could not be loaded.',
    'Envoi du message…': 'Sending message…',
    'Afficher les messages': 'Show messages',
    'Tous les messages': 'All messages',
    'Messages envoyés': 'Sent messages',
    'Aucun message dans cette catégorie.': 'No messages in this category.',
    'Les transmissions restent visibles quel que soit le filtre.': 'Updates remain visible regardless of the filter.',
    'Impossible de charger les messages.': 'Unable to load messages.',
    'Rappels des tâches': 'Task reminders',
    'Activer les rappels de tâches': 'Enable task reminders',
    'Enregistrer les rappels': 'Save reminders',
    'Chargement des rappels…': 'Loading reminders…',
    'Choix des rappels enregistré.': 'Reminder preference saved.',
    'Dates selon l’heure de Paris. Les aidants peuvent activer leurs propres rappels.':
      'Dates follow Paris time. Caregivers can enable their own reminders.',
    'Dates selon l’heure de Paris. Les rappels facultatifs se règlent dans Réglages.':
      'Dates follow Paris time. Optional reminders are configured in Settings.',
    'Affichage senior': 'Senior display',
    'Activer la vue simplifiée': 'Enable simplified view',
    'Afficher toutes les fonctions': 'Show all features',
    'Si vous les activez, un rappel est créé à partir de 9 h, heure de Paris, pour les tâches du jour non terminées dont vous vous chargez ou sans volontaire. Il concerne tous vos profils associés. La réception hors de l’application dépend des notifications activées sur vos appareils ou de vos choix SMS et e-mail.':
      'When enabled, a reminder is created from 9 a.m. Paris time for unfinished tasks due today that you claimed or that have no volunteer. This applies to all linked profiles. Receiving reminders outside the app depends on device notifications or your SMS and email preferences.',
    'Chargement du prochain rendez-vous…': 'Loading your next appointment…',
    'Aucun rendez-vous à venir.': 'No upcoming appointments.',
    'Impossible de charger le prochain rendez-vous.': 'Unable to load your next appointment.',
    'Ces tâches sont visibles et modifiables par vous et tous vos aidants associés. Évitez les informations médicales.':
      'These tasks are visible and editable by you and all your linked caregivers. Avoid medical information.',
    'Ces tâches sont visibles et modifiables par le senior et tous ses aidants associés. Évitez les informations médicales.':
      'These tasks are visible and editable by the senior and all their linked caregivers. Avoid medical information.',
    'Nouvelle tâche': 'New task',
    'Date prévue (facultative)': 'Planned date (optional)',
    'Date prévue': 'Planned date',
    'Sans date prévue': 'No planned date',
    'Dates selon l’heure de Paris ; aucun rappel n’est envoyé.': 'Dates follow Paris time; no reminders are sent.',
    'Actualiser les tâches': 'Refresh tasks',
    'En retard': 'Overdue',
    'Terminées': 'Completed',
    'Modifier la date': 'Change date',
    'Enregistrer la date': 'Save date',
    'Ajouter': 'Add',
    'Supprimer': 'Delete',
    'Chargement des tâches…': 'Loading tasks…',
    'Aucune tâche pour le moment.': 'No tasks yet.',
    'Marquer à faire': 'Mark as to do',
    'Marquer terminée': 'Mark as done',
    'Terminée': 'Done',
    'À faire': 'To do',
    'Supprimer cette tâche pour tous ?': 'Delete this task for everyone?',
    'Tâches partagées': 'Shared tasks',
    'Pour une urgence, appelez les secours.': 'In an emergency, call the emergency services.',
    'Appuyez sur le micro pour dicter votre compte-rendu de visite.': 'Press the microphone to dictate your visit report.',
    'Annuaire partagé': 'Shared directory',
    'Les professionnels enregistrés ici sont visibles et modifiables par le senior et ses aidants associés.':
      'Professionals saved here can be viewed and managed by the senior and their linked caregivers.',
    'Actualiser l’annuaire partagé': 'Refresh shared directory',
    'Chargement de l’annuaire partagé…': 'Loading shared directory…',
    'Aucun professionnel enregistré dans cet annuaire.': 'No professionals saved in this directory.',
    'Ce professionnel n’est plus disponible dans l’annuaire.': 'This professional is no longer available in the directory.',
    'Ajouter à l’annuaire partagé': 'Add to shared directory',
    'Retirer de l’annuaire partagé': 'Remove from shared directory',
    'Professionnel ajouté à l’annuaire partagé': 'Professional added to the shared directory',
    'Professionnel retiré de l’annuaire partagé': 'Professional removed from the shared directory',
    'Impossible de modifier l’annuaire partagé.': 'Unable to update the shared directory.',
    'Professionnels vérifiés': 'Verified professionals',
    'Autres résultats non vérifiés': 'Other unverified results',
    'Leur distance n’est pas calculée : ils peuvent être hors du rayon. Certains résultats concernent le département ou toute la France. La réservation en ligne n’est pas disponible.':
      'Their distance is not calculated: they may be outside the radius. Some results cover the department or all of France. Online booking is not available.',
    'Aucun autre résultat disponible.': 'No other results available.',
    'Aucun professionnel vérifié ne correspond à cette recherche.': 'No verified professional matches this search.',
    'Impossible d’identifier la commune à partir du GPS : les recherches locales extérieures ne sont pas disponibles.':
      'The municipality could not be identified from GPS: local external searches are unavailable.',
    'L’annuaire public est indisponible. Les autres résultats restent affichés ; réessayez plus tard.':
      'The public directory is unavailable. Other results are still shown; try again later.',
    'Pour consulter l’annuaire public, indiquez un nom ou une activité et une commune ou un code postal.':
      'To search the public directory, enter a name or activity and a municipality or postal code.',
    'Chacun peut se proposer pour une tâche. Vous pouvez libérer une tâche si la personne n’est plus disponible ; cela n’envoie pas de notification.':
      'Anyone can volunteer for a task. You can release a task if the person is no longer available; no notification is sent.',
    'Vous pouvez vous proposer pour une tâche et vous retirer ensuite. Le senior peut aussi libérer une tâche. Aucune notification n’est envoyée.':
      'You can volunteer for a task and withdraw later. The senior can also release a task. No notification is sent.',
    'Prise en charge par': 'Handled by',
    'Personne indisponible': 'Person unavailable',
    'Personne ne s’est encore proposé': 'Nobody has volunteered yet',
    'Je m’en charge': 'I will take care of it',
    'Je me retire': 'Withdraw',
    'Libérer la tâche': 'Release task',
    'Libérer cette tâche pour que quelqu’un d’autre puisse s’en charger ?': 'Release this task so someone else can take care of it?',
    'Vérification de la connexion...': 'Checking connection...',
    'Se connecter': 'Sign in',
    'S’inscrire': 'Sign up',
    "S'inscrire": 'Sign up',
    'Ouvrir l’application en ligne': 'Open the app online',
    'Utilisez l’application directement en ligne, sans installer de fichier.': 'Use the app online without installing a file.',
    'Sur votre téléphone, le menu de votre navigateur peut proposer « Ajouter à l’écran d’accueil » pour retrouver facilement le site.':
      'On your phone, your browser menu may offer “Add to home screen” so you can easily find the site again.',
    'Besoin d’aide pour installer l’application Android ?': 'Need help installing the Android app?',
    'Télécharger l’application Android': 'Download the Android app',
    'Conditions d’utilisation': 'Terms of use',
    'Mentions légales': 'Legal notice',
    'Tarifs et CGV': 'Pricing and terms of sale',
    'Confidentialité': 'Privacy',
    'Fonctionnalités': 'Features',
    'Langue': 'Language',
    'Ville': 'City',
    'Code postal': 'Postal code',
    'Rayon de recherche (km)': 'Search radius (km)',
    'Choisissez une commune': 'Choose a municipality',
    'Choisir une commune': 'Choose a municipality',
    'Rechercher la commune': 'Search for a municipality',
    'Date du rendez-vous': 'Appointment date',
    'Utiliser ma position GPS pour la recherche': 'Use my GPS position for the search',
    'Saisissez une ville ou un code postal.': 'Enter a city or postal code.',
    'Saisissez un code postal français à cinq chiffres.': 'Enter a five-digit French postal code.',
    'Le service de recherche des communes est indisponible.': 'The municipality search service is unavailable.',
    'Réponse invalide du service de recherche des communes.': 'Invalid response from the municipality search service.',
    'Aucune commune trouvée avec cette ville et ce code postal.': 'No municipality found for this city and postal code.',
    'Choisissez une commune dans la liste, puis relancez la recherche.':
      'Choose a municipality from the list, then search again.',
    'Choisissez votre commune dans la liste, puis appuyez sur Continuer.':
      'Choose your municipality from the list, then press Continue.',
    'La recherche a changé. Relancez-la.': 'The search changed. Please run it again.',
    'Choisissez un rayon entier compris entre 1 et 500 km.': 'Choose a whole-number radius between 1 and 500 km.',
    'Centre approximatif sélectionné': 'Approximate centre selected',
    'Autorisez la localisation dans les paramètres de l’application, puis réessayez.':
      'Allow location access in the app settings, then try again.',
    'Activez les services de localisation sur votre téléphone, puis réessayez.':
      'Turn on location services on your phone, then try again.',
    'Position indisponible. Activez les services de localisation et réessayez.':
      'Position unavailable. Turn on location services and try again.',
    'La recherche de position a expiré. Réessayez à l’extérieur ou utilisez une commune.':
      'The location request timed out. Try again outdoors or use a municipality.',
    'Impossible de relever la position. Vérifiez les autorisations et les services de localisation.':
      'Unable to get your location. Check app permissions and location services.',
    'Le module GPS de l’application est indisponible. Réinstallez sa dernière version.':
      'The app GPS module is unavailable. Reinstall the latest version.',
    'Mon point de départ et mon rayon d’intervention': 'My starting point and service radius',
    'Choisissez votre position GPS ou le centre approximatif d’une commune française comme point de départ. Pour rechercher une commune, sa ville ou son code postal est transmis au service public geo.api.gouv.fr. Les distances sont calculées à vol d’oiseau.':
      'Choose your GPS location or the approximate centre of a French municipality as your starting point. The city or postal code is sent to the public service geo.api.gouv.fr to find the municipality. Distances are straight-line estimates.',
    'La ville ou le code postal est transmis au service public geo.api.gouv.fr pour trouver le centre de la commune. Le rayon est calculé à vol d’oiseau. Sans lieu, la recherche est nationale.':
      'The city or postal code is sent to the public service geo.api.gouv.fr to find the municipality centre. The radius is measured in a straight line. Without a location, the search is nationwide.',
    'Réglages': 'Settings',
    'Agenda': 'Calendar',
    'Jour': 'Day',
    'Explications sur l’agenda': 'About the calendar',
    'Mon agenda': 'My calendar',
    'Rendez-vous de la semaine': 'Appointments this week',
    'Aucun rendez-vous pour cette semaine.': 'No appointments this week.',
    'Consultez les rendez-vous et les disponibilités correspondant à votre compte.':
      'View appointments and availability for your account.',
    'Accéder à mon agenda': 'Open my calendar',
    'Gérer mes profils seniors': 'Manage my senior profiles',
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
    'Profils seniors indisponibles': 'Senior profiles unavailable',
    'Impossible de charger les profils seniors. Vérifiez votre connexion et réessayez.':
      'Unable to load senior profiles. Check your connection and try again.',
    'Actualiser les profils seniors': 'Refresh senior profiles',
    'Aucun profil n’est disponible. Demandez l’accès à un senior ou contactez l’administration si vous êtes tuteur légal.':
      'No profile is available. Request access from a senior or contact the administrator if you are a legal guardian.',
    'Accès des aidants à mon profil': 'Caregiver access to my profile',
    'Vous pouvez accepter ou refuser les demandes. Pour retirer un accès, il sera suspendu immédiatement ; l’administration vous enverra ensuite un code de confirmation par e-mail.':
      'You can accept or decline requests. Access is suspended immediately when you request removal; the administrator will then email you a confirmation code.',
    'Cette suspension ne supprime pas l’aidant de vos contacts et n’arrête pas les alertes d’urgence qui leur sont destinées.':
      'Suspending access does not remove the caregiver from your contacts or stop emergency alerts sent to them.',
    'Chargement des demandes…': 'Loading requests…',
    'Actualiser': 'Refresh',
    'Mes profils seniors': 'My senior profiles',
    'Saisissez l’adresse e-mail du senior. Il devra accepter votre demande avant que vous puissiez consulter son profil.':
      'Enter the senior’s email address. They must accept your request before you can access their profile.',
    'Adresse e-mail du senior': 'Senior’s email address',
    'Demander l’accès': 'Request access',
    'Pour un tuteur légal, l’administration vérifie et associe les profils seniors.':
      'For legal guardians, the administrator verifies and links senior profiles.',
    'Chargement des profils…': 'Loading profiles…',
    'Aucune association ou demande en cours.': 'No current links or requests.',
    'Accepter': 'Accept',
    'Accès suspendu ; confirmation par code attendue.': 'Access suspended; code confirmation pending.',
    'Demande de retrait transmise à l’administration.': 'Removal request sent to the administrator.',
    'Code reçu par e-mail': 'Code received by email',
    'Confirmer le retrait': 'Confirm removal',
    'Retrait confirmé.': 'Removal confirmed.',
    'Demander le retrait': 'Request removal',
    'Suspendre immédiatement l’accès de cet aidant et demander un code à l’administration ?':
      'Immediately suspend this caregiver’s access and request a code from the administrator?',
    'Demander à l’administration de retirer ce profil ?': 'Ask the administrator to remove this profile?',
    'Impossible de charger les associations.': 'Unable to load links.',
    'Si ce compte senior existe et peut recevoir la demande, elle lui sera présentée dans son espace.':
      'If the senior account exists and can receive the request, it will appear in their account.',
    'Demandes de retrait d’accès': 'Access removal requests',
    'Pour une demande du senior, l’accès est suspendu : envoyez-lui le code de confirmation par e-mail. Pour une demande de l’aidant, retirez l’association depuis ce tableau.':
      'For a senior’s request, access is suspended: send them a confirmation code by email. For a caregiver’s request, remove the link from this panel.',
    'Le senior doit accepter la demande de l’aidant dans son espace.':
      'The senior must accept the caregiver’s request in their account.',
    'Aucune demande de retrait en cours.': 'No pending removal requests.',
    'Demandé par le senior : accès suspendu.': 'Requested by the senior: access suspended.',
    'Demandé par l’aidant.': 'Requested by the caregiver.',
    'Envoyer le code par e-mail': 'Send code by email',
    'Retirer l’association': 'Remove link',
    'Envoyer un code au senior ?': 'Send the senior a code?',
    'Retirer cette association ?': 'Remove this link?',
    'Code envoyé au senior.': 'Code sent to the senior.',
    'Association retirée.': 'Link removed.',
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
    'Explications': 'More information',
    'Écrire à l’équipe': 'Write to the team',
    'Mes réglages': 'My settings',
    'Mes centres d’intérêt': 'My interests',
    'Mes découvertes du jour': 'My daily discoveries',
    'Recette du jour': 'Recipe of the day',
    'Des idées à retrouver à tour de rôle. Adaptez les ingrédients à vos allergies et à vos besoins.':
      'Ideas to enjoy in rotation. Adapt the ingredients to your allergies and needs.',
    'Que souhaitez-vous découvrir ?': 'What would you like to discover?',
    'Modifier mes centres d’intérêt': 'Change my interests',
    'Choisissez librement. Ces choix restent privés et peuvent être modifiés dans les réglages.':
      'Choose freely. Your choices are private and can be changed in settings.',
    'Qu’aimez-vous ?': 'What do you like?',
    'Des recettes salées': 'Savoury recipes',
    'Des recettes sucrées': 'Sweet recipes',
    'Des photos de paysages et de nature': 'Nature and landscape photos',
    'Des photos d’animaux': 'Animal photos',
    'De la musique au piano': 'Piano music',
    'Vous pouvez aussi continuer sans choisir.': 'You can also continue without choosing.',
    'Vous pouvez aussi écrire des mots que vous aimez, par exemple : chat, pomme, piano.':
      'You can also write words in French, for example: chat, pomme, piano.',
    'N’indiquez pas d’informations médicales ou sensibles. Les propositions restent limitées aux thèmes disponibles.':
      'Do not enter medical or sensitive information. Suggestions are limited to available themes.',
    'Thèmes reconnus dans votre texte :': 'Themes recognised in your text:',
    'Nous ne proposons pas encore de découverte pour votre texte.': 'We do not yet offer a discovery for your text.',
    'Enregistrer mes choix': 'Save my choices',
    'Chargement de vos centres d’intérêt…': 'Loading your interests…',
    'Impossible de charger vos centres d’intérêt.': 'Unable to load your interests.',
    'Réessayer': 'Try again',
    'Enregistrement…': 'Saving…',
    'Vos choix sont enregistrés.': 'Your choices have been saved.',
    'Impossible d’enregistrer vos choix. Réessayez.': 'Unable to save your choices. Please try again.',
    'Photo du jour': 'Photo of the day',
    'Musique du jour': 'Music of the day',
    'Des fleurs au printemps': 'Spring flowers',
    'Un paysage d’été': 'A summer landscape',
    'Un paysage d’automne': 'An autumn landscape',
    'Un paysage d’hiver': 'A winter landscape',
    'Un chat': 'A cat',
    'Un chien': 'A dog',
    'Un cheval': 'A horse',
    'Un mouton': 'A sheep',
    'Crédits des photos': 'Photo credits',
    'Crédits': 'Credits',
    'Valse de Chopin': 'A Chopin waltz',
    'Nicaragua, au piano': 'Nicaragua, on the piano',
    'Écouter sur Wikimedia Commons': 'Listen on Wikimedia Commons',
    'Le lien ouvre un autre site. Aucune musique ne démarre automatiquement dans l’application.':
      'The link opens another site. No music plays automatically in the app.',
    'Trouver un professionnel': 'Find a professional',
    'Envoyer ma réponse': 'Send my answer',
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
    'Étape 1 sur 4 : votre profil': 'Step 1 of 4: your profile',
    'Étape': 'Step',
    'sur': 'of',
    'votre profil': 'your profile',
    'votre identité et votre accès': 'your identity and access',
    'vos informations': 'your information',
    'vérification et conditions': 'review and terms',
    'Progression de l’inscription': 'Registration progress',
    'Votre profil': 'Your profile',
    'L’accès de base à l’application est gratuit.': 'Basic access to the application is free.',
    'Une option Premium payante pour un futur carnet de soins est envisagée ; elle n’est pas encore disponible. Le carnet actuel concerne le quotidien et ne doit pas contenir de données de santé.': 'A paid Premium option for a future care record is planned but not yet available. The current record is for everyday updates and must not contain health data.',
    'L’activation de l’espace établissement est manuelle, sans paiement en ligne ; contactez l’administration pour les conditions.': 'Organization access is activated manually, without online payment; contact the administration for details.',
    'Adresse pour une livraison de tablette': 'Address for tablet delivery',
    'Si vous indiquez un intérêt pour une tablette, complétez toute l’adresse. Sinon, vous pouvez la laisser vide. La renseigner ne constitue pas une commande.': 'If you indicate interest in a tablet, complete the entire address. Otherwise, you can leave it blank. Providing it does not place an order.',
    'Adresse postale': 'Street address',
    'Pays': 'Country',
    'Adresse de livraison': 'Delivery address',
    'Intérêt pour une tablette': 'Interest in a tablet',
    'Pour une livraison de tablette, complétez toute l’adresse.': 'For tablet delivery, complete the entire address.',
    'Cette commune française de référence pour la météo est distincte de l’adresse de livraison.': 'This French municipality used for the weather is separate from the delivery address.',
    'Une tablette vous intéresse-t-elle ?': 'Are you interested in a tablet?',
    'Choisissez une réponse': 'Choose an answer',
    'Non': 'No',
    'Achat seul : 299 € TTC (prix indicatif)': 'Purchase only: €299 including tax (indicative price)',
    'Achat : 299 € TTC + Premium à venir (tarif à définir)': 'Purchase: €299 including tax + future Premium (price to be determined)',
    'Location : 25 € HT / mois sur 12 mois + Premium à venir (tarif à définir)': 'Rental: €25 excluding tax / month over 12 months + future Premium (price to be determined)',
    'Indiquez votre choix concernant la tablette.': 'Choose your tablet preference.',
    'Tablette et adresse de livraison': 'Tablet and delivery address',
    'Prix indicatifs à confirmer par devis et selon disponibilité : achat de la tablette seule à 299 € TTC ; location envisagée à 25 € HT par mois avec engagement de 12 mois et service Premium en supplément. Le tarif Premium reste à définir et l’option n’est pas encore disponible. Votre réponse indique uniquement un intérêt : elle ne crée ni commande, ni paiement, ni engagement. L’administration pourra consulter votre réponse et, si vous êtes intéressé(e), votre adresse pour vous contacter.': 'Indicative prices, subject to a quote and availability: tablet purchase €299 including tax; proposed rental €25 excluding tax per month with a 12-month commitment and Premium service at an additional cost. Premium pricing is not yet defined and the option is not yet available. Your answer only records interest: it does not place an order, make a payment or create a commitment. The administration can view your choice and, if interested, your address to contact you.',
    'Prix indicatifs à confirmer par devis et selon disponibilité : achat de la tablette seule à 299 € TTC ; location envisagée à 25 € HT par mois avec engagement de 12 mois et service Premium en supplément. Le tarif Premium reste à définir et l’option n’est pas encore disponible. Ce choix n’est ni une commande, ni un paiement, ni un engagement. L’administration pourra consulter votre choix et, si vous êtes intéressé(e), votre adresse pour vous contacter.': 'Indicative prices, subject to a quote and availability: tablet purchase €299 including tax; proposed rental €25 excluding tax per month with a 12-month commitment and Premium service at an additional cost. Premium pricing is not yet defined and the option is not yet available. This choice does not place an order, make a payment or create a commitment. The administration can view your choice and, if interested, your address to contact you.',
    'L’adresse complète est nécessaire si vous souhaitez une tablette. Vous pouvez aussi la supprimer en choisissant « Non » et en vidant les champs.': 'A complete address is required if you want a tablet. You can also remove it by choosing “No” and clearing the fields.',
    'Votre choix': 'Your choice',
    'Enregistrer mon choix': 'Save my choice',
    'Choix enregistré. Ce n’est pas une commande.': 'Choice saved. This is not an order.',
    'Votre identité et votre accès': 'Your identity and access',
    'Vos informations': 'Your information',
    'Vérification et conditions': 'Review and terms',
    'Code d’accès (12 caractères minimum)': 'Access code (at least 12 characters)',
    'Code d’accès (12 caractères min)': 'Access code (at least 12 characters)',
    'Confirmez votre code d’accès': 'Confirm your access code',
    'Les codes d’accès correspondent.': 'The access codes match.',
    'Les codes d’accès ne correspondent pas.': 'The access codes do not match.',
    'Choisissez un type de compte.': 'Choose an account type.',
    'Choisissez votre profil': 'Choose your profile',
    'Saisissez votre prénom.': 'Enter your first name.',
    'Saisissez votre nom.': 'Enter your last name.',
    'Saisissez une adresse e-mail valide.': 'Enter a valid email address.',
    'Choisissez un code d’accès de 12 caractères minimum.': 'Choose an access code of at least 12 characters.',
    'Ajoutez les justificatifs demandés.': 'Add the required documents.',
    'Chaque justificatif doit être un fichier PDF, JPEG ou PNG de 10 Mo maximum.': 'Each document must be a PDF, JPEG or PNG file no larger than 10 MB.',
    'Précédent': 'Previous',
    'Continuer': 'Continue',
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
    'Vérification de bien-être': 'Wellbeing check-in',
    'Écrire ou voir ma réponse': 'Write or see my answer',
    'Bien': 'Good',
    'Moyen': 'Okay',
    'Pas bien': 'Not well',
    'Bonjour. Comment allez-vous aujourd’hui ?': 'Hello. How are you feeling today?',
    'Vous allez bien. Souhaitez-vous ajouter quelque chose ?': 'You are feeling well. Would you like to add anything?',
    'Vous pouvez préciser comment vous vous sentez.': 'You can say more about how you feel.',
    'Vous pouvez expliquer ce qui ne va pas. En cas d’urgence, appelez le 15 ou le 112.': 'You can explain what is wrong. In an emergency, call 15 or 112.',
    'Votre choix sera envoyé seulement si vous confirmez. Vous pouvez ajouter un message.': 'Your choice will only be sent if you confirm. You can add a message.',
    'Votre réponse doit contenir au maximum 1 200 caractères, choix compris.': 'Your answer must contain at most 1,200 characters, including your choice.',
    'Vous pouvez aussi agrandir tout l’affichage sur cet appareil, sans masquer de fonctions.': 'You can also enlarge the entire display on this device without hiding features.',
    'Agrandir tout l’affichage': 'Enlarge the entire display',
    'Affichage agrandi activé.': 'Enlarged display on.',
    'Affichage agrandi désactivé.': 'Enlarged display off.',
    'Vérifications de bien-être partagées': 'Shared wellbeing check-ins',
    'Aujourd’hui : notifications': 'Today: notifications',
    'Messages reçus': 'Received messages',
    'Aucun message reçu pour le moment.': 'No messages received yet.',
    'message non lu dans cette conversation': 'unread message in this conversation',
    'messages non lus dans cette conversation': 'unread messages in this conversation',
    'Les 20 conversations les plus récentes sont affichées. Retrouvez les autres dans Messages en choisissant un correspondant.': 'The 20 most recent conversations are shown. Find the others in Messages by choosing a contact.',
    'Impossible de charger la boîte de réception.': 'Unable to load the inbox.',
    'Aucun aujourd’hui.': 'None today.',
    'Les notifications et nouveaux messages peuvent être envoyés en notification push, même lorsque l’application est fermée. Activez-les sur chaque appareil et autorisez-les dans ses réglages. La réception dépend de l’appareil, du navigateur et du service ; elle n’est pas garantie. La déconnexion les désactive sur cet appareil.':
      'Notifications and new messages can be sent as push notifications, even when the app is closed. Enable them on each device and allow them in its settings. Delivery depends on the device, browser and service and is not guaranteed. Signing out disables them on this device.',
    'Messages automatiques de sécurité': 'Automatic safety messages',
    'Ces messages sont générés par l’application, pas rédigés par la personne accompagnée. Ils ne garantissent pas la réception d’une alerte ni l’intervention des secours.':
      'These messages are generated by the app, not written by the person receiving support. They do not guarantee that an alert is received or emergency services respond.',
    'Chargement des messages de sécurité…': 'Loading safety messages…',
    'Aucun message de sécurité pour le moment.': 'No safety messages at the moment.',
    'Impossible de charger les messages de sécurité.': 'Unable to load safety messages.',
    'Chargement de votre vérification de bien-être…': 'Loading your wellbeing check-in…',
    'Votre vérification de bien-être du jour est déjà enregistrée.': 'Your wellbeing check-in for today is already saved.',
    'Impossible de charger votre vérification de bien-être.': 'Unable to load your wellbeing check-in.',
    'Impossible d’enregistrer votre vérification de bien-être.': 'Unable to save your wellbeing check-in.',
    'Aucune vérification de bien-être ne vous a été partagée pour le moment.': 'No wellbeing check-ins have been shared with you yet.',
    'Impossible de charger les vérifications de bien-être partagées.': 'Unable to load shared wellbeing check-ins.',
    'La conversation IA avec les seniors est désactivée. Le réglage d’activation concerne encore la vérification de bien-être et l’aide à la rédaction. Seuls les administrateurs autorisés voient les demandes de contact humain.':
      'AI chat with seniors is disabled. The setting still applies to wellbeing check-ins and writing assistance. Only authorized administrators can view requests to speak with a person.',
    'Contacter l’équipe': 'Contact the team',
    'La conversation avec l’assistant IA est désactivée. Vous pouvez demander à l’équipe de vous répondre ici. Les conversations existantes sont supprimées après 30 jours d’inactivité.':
      'The AI chat is disabled. You can ask the team to reply here. Existing conversations are deleted after 30 days of inactivity.',
    'Choisissez les alertes qui comptent pour vous et contactez l’équipe si vous avez besoin d’aide.':
      'Choose the alerts that matter to you and contact the team if you need help.',
    'Vous pouvez écrire votre réponse ou la dicter. L’assistant IA vous répondra par écrit ; vous pourrez aussi écouter sa réponse.':
      'You can type or dictate your answer. The AI assistant will reply in writing, and you can also listen to its response.',
    '🔊 Écouter la question': '🔊 Listen to the question',
    'Cette fonction n’est pas un service d’urgence et ne surveille pas votre sécurité. En cas de danger immédiat, appelez le 112 ou le 15.':
      'This feature is not an emergency service and does not monitor your safety. If you are in immediate danger, call 112 or 15.',
    'Votre réponse': 'Your answer',
    '🎙️ Dicter ma réponse': '🎙️ Dictate my answer',
    '🎙️ Dicter mon message': '🎙️ Dictate my message',
    'Arrêter la dictée': 'Stop dictation',
    '✨ Aide à la rédaction': '✨ Writing assistance',
    'La dictée dépend du navigateur : son fournisseur peut traiter votre voix. Vérifiez le texte avant de l’envoyer.':
      'Dictation depends on your browser: its provider may process your voice. Check the text before sending it.',
    'L’aide à la rédaction envoie votre brouillon à OpenAI après votre confirmation. Elle peut faire des erreurs.':
      'Writing assistance sends your draft to OpenAI after your confirmation. It can make mistakes.',
    'Proposition à vérifier :': 'Suggestion to check:',
    'Utiliser la proposition': 'Use suggestion',
    'Garder mon texte': 'Keep my text',
    'La dictée n’est pas disponible sur cet appareil. Vous pouvez écrire votre message.':
      'Dictation is unavailable on this device. You can type your message.',
    'Écoute en cours. Parlez puis arrêtez la dictée.': 'Listening. Speak, then stop dictation.',
    'Le message est trop long : la fin de la dictée a été coupée. Vérifiez le texte.':
      'The message is too long: the end of the dictation was cut off. Check the text.',
    'Dictée ajoutée. Vérifiez le message avant de l’envoyer.': 'Dictation added. Check the message before sending it.',
    'L’accès au microphone a été refusé. Vous pouvez écrire votre message.':
      'Microphone access was denied. You can type your message.',
    'La dictée a échoué. Vous pouvez écrire votre message.': 'Dictation failed. You can type your message.',
    'Aucune parole reconnue. Vous pouvez réessayer ou écrire votre message.':
      'No speech was recognized. You can try again or type your message.',
    'Impossible de démarrer la dictée. Vous pouvez écrire votre message.':
      'Unable to start dictation. You can type your message.',
    'Impossible d’arrêter la dictée. Vous pouvez écrire votre message.':
      'Unable to stop dictation. You can type your message.',
    'Écrivez ou dictez un message avant de demander une proposition.':
      'Type or dictate a message before requesting a suggestion.',
    'Votre brouillon sera envoyé à OpenAI pour proposer une reformulation. Évitez les informations sensibles. Continuer ?':
      'Your draft will be sent to OpenAI to suggest a rewrite. Avoid sensitive information. Continue?',
    'Préparation de la proposition…': 'Preparing the suggestion…',
    'Vérifiez la proposition avant de l’utiliser.': 'Check the suggestion before using it.',
    'Impossible de préparer une proposition.': 'Unable to prepare a suggestion.',
    '🔊 Lecture à voix haute': '🔊 Read aloud',
    'La lecture est activée par défaut sur cet appareil lorsque l’application est ouverte. Les personnes autour de vous peuvent l’entendre. Le navigateur peut demander une première action avant de parler.':
      'Reading aloud is enabled by default on this device while the app is open. People around you can hear it. Your browser may require an initial action before speaking.',
    'Lire les informations à voix haute': 'Read information aloud',
    'Choisir une voix': 'Choose a voice',
    'Voix de l’appareil': 'Device voice',
    'Arrêter la lecture': 'Stop reading',
    'La lecture vocale n’est pas disponible sur cet appareil.': 'Speech is not available on this device.',
    'La lecture a échoué. Vérifiez le son et les réglages de votre appareil.':
      'Reading failed. Check your device sound and settings.',
    'Dicter le compte-rendu': 'Dictate the report',
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
    'Civilité': 'Title',
    'Non défini': 'Not specified',
    'Monsieur': 'Mr',
    'Madame': 'Ms',
    'Mon profil': 'My profile',
    'Photo de profil (facultative)': 'Profile photo (optional)',
    'Photo de profil (obligatoire)': 'Profile photo (required)',
    'JPEG ou PNG, 2 Mo maximum. La photo est partagée par défaut avec les personnes qui vous ont ajouté à leurs contacts. Les intervenants doivent en ajouter une ; les autres peuvent désactiver le partage dans les réglages.': 'JPEG or PNG, up to 2 MB. Your photo is shared by default with people who have added you to their contacts. Professionals must add one; other users can turn sharing off in settings.',
    'Pour les intervenants, une photo est obligatoire et visible par les personnes qui les ont ajoutés à leurs contacts. Vous pouvez la remplacer.': 'Professionals must have a photo, visible to people who have added them to their contacts. You can replace it.',
    'Ajoutez une photo de profil pour créer un compte intervenant.': 'Add a profile photo to create a professional account.',
    'JPEG ou PNG, 2 Mo maximum. Vous pouvez choisir de la partager dans les réglages.': 'JPEG or PNG, up to 2 MB. You can choose to share it in settings.',
    'JPEG ou PNG, 2 Mo maximum.': 'JPEG or PNG, up to 2 MB.',
    'Partager ma photo avec les personnes qui m’ont ajouté à leurs contacts': 'Share my photo with people who have added me to their contacts',
    'Enregistrer mon profil': 'Save my profile',
    'Enregistrer la photo': 'Save photo',
    'Supprimer la photo': 'Delete photo',
    'Profil enregistré.': 'Profile saved.',
    'Photo de profil enregistrée.': 'Profile photo saved.',
    'Photo de profil supprimée.': 'Profile photo deleted.',
    'Impossible de charger votre photo de profil.': 'Unable to load your profile photo.',
    'Impossible de charger la photo du contact.': 'Unable to load the contact’s photo.',
    'Choisissez une image JPEG ou PNG valide (2 Mo maximum).': 'Choose a valid JPEG or PNG image (up to 2 MB).',
    'Compte créé et photo enregistrée, mais son affichage est indisponible.': 'Account created and photo saved, but it could not be displayed.',
    'Compte créé, mais la photo n’a pas été enregistrée.': 'Account created, but the photo was not saved.',
    'Navigation principale': 'Main navigation',
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
    'Inscrivez d’abord son compte professionnel dans l’équipe. Les modèles ci-dessous sont des paramètres techniques ; aucun paiement n’est activé.':
      'First add their professional account to the team. The models below are technical settings; no payment is enabled.',
    'Choisir un intervenant de l’équipe': 'Choose a team professional',
    'Choisir un service': 'Choose a service',
    'Livraison de repas': 'Meal delivery',
    'Coiffure à domicile': 'Home hairdressing',
    'Ménage à domicile': 'Home cleaning',
    'Choisir le modèle de rémunération': 'Choose a payment model',
    'Abonnement (paiement non activé)': 'Subscription (payment not enabled)',
    'Participation après prestation réalisée (paiement non activé)': 'Fee after completed service (payment not enabled)',
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
    'Abonnement · paiement non activé': 'Subscription · payment not enabled',
    'Après prestation · paiement non activé': 'After service · payment not enabled',
    'Participation après prestation réalisée · paiement non activé': 'Fee after completed service · payment not enabled',
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
    'Prénom': 'First name',
    'Nom de famille': 'Last name',
    'Saisissez votre prénom et votre nom.': 'Enter your first and last name.',
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
    'Fiches privées renseignées par les établissements. Leur identité et leurs coordonnées ne sont pas vérifiées automatiquement. L’accès est géré manuellement : aucun paiement en ligne ni échéance automatique.':
      'Private profiles provided by organizations. Their identity and contact details are not automatically verified. Access is managed manually: no online payment or automatic renewal.',
    'Nombre de personnes renseigné par l’administration, non compté automatiquement. La grille affichée correspond à une ancienne proposition, non appliquée ; les tarifs de la partie médicale restent à préciser.':
      'The number of people is entered by the administration, not counted automatically. The displayed scale is an old proposal and is not applied; medical-section prices remain to be determined.',
    'Les modèles de rémunération sont des paramètres techniques ; aucun paiement n’est activé.':
      'The payment models are technical settings; no payment is enabled.',
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
  document.documentElement.lang = language;

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
    const control = document.createElement('div');
    control.className = 'gl-language-switch';

    control.setAttribute('role', 'group');
    control.setAttribute('aria-label', 'Langue');
    const flagSvg = {
      fr: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="10" height="20" fill="#0055a4"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ef4135"/></svg>',
      en: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40"><rect width="60" height="40" fill="#012169"/><path d="M0 0l60 40M60 0L0 40" stroke="#fff" stroke-width="8"/><path d="M0 0l60 40M60 0L0 40" stroke="#c8102e" stroke-width="3"/><path d="M30 0v40M0 20h60" stroke="#fff" stroke-width="12"/><path d="M30 0v40M0 20h60" stroke="#c8102e" stroke-width="7"/></svg>'
    };
    const flags = [['fr', 'Français'], ['en', 'English']];
    const buttons = flags.map(([code, name]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = flagSvg[code];
      button.title = name;
      button.setAttribute('aria-label', name);
      button.addEventListener('click', () => setLanguage(code));
      return [code, button];
    });
    const refreshFlags = () => buttons.forEach(([code, button]) => {
      button.setAttribute('aria-pressed', String(code === language));
    });
    refreshFlags();
    window.addEventListener('generationliaisonlanguagechange', refreshFlags);

    control.append(...buttons.map(([, button]) => button));
    document.body.insertBefore(control, document.body.firstChild);

    const style = document.createElement('style');
    style.textContent = `
      .gl-language-switch {
        position: absolute;
        top: 0;
        right: 0;
        z-index: 30;
        display: flex;
        gap: 6px;
        padding: 8px 12px;
      }
      .gl-language-switch button {
        width: 38px;
        height: 32px;
        padding: 0;
        border: 2px solid transparent;
        border-radius: 8px;
        background: rgba(255, 255, 255, .85);
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
      }
      .gl-language-switch button svg {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: 4px;
      }
      .gl-language-switch button[aria-pressed="true"] {
        border-color: #2a9d78;
      }
      .gl-language-switch button:focus-visible {
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
