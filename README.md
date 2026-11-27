# Mes Invaders

Web app pour iPhone (à installer sur l'écran d'accueil) :
- carte de ta collection d'invaders flashés, avec tes photos ;
- bouton « Invaders restants autour de moi » : invaders non flashés dans un rayon de 300 m à 5 km, triés par distance ;
- import de ta liste de flashs (copier-coller), sauvegarde/restauration en fichier.

Tout reste sur ton téléphone (IndexedDB). Aucune donnée envoyée à un serveur.

## Données
Positions : base communautaire https://github.com/goguelnikov/SpaceInvaders (V06, licence MIT), convertie dans `data/invaders.json`.
Fond de carte : © OpenStreetMap.

## Mise en ligne (GitHub Pages)
1. Mets ces fichiers à la racine d'un dépôt GitHub.
2. Settings › Pages › Source : « Deploy from a branch », branche `main`, dossier `/ (root)`.
3. Ouvre l'adresse `https://<ton-compte>.github.io/<dépôt>/` dans Safari sur l'iPhone, puis Partager › « Sur l'écran d'accueil ».
