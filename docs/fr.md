# RESOL (KM2, DL2, DL2Plus, DL3)

Intégration non officielle, sans lien avec RESOL. Elle lit vos **régulateurs
solaires et de chauffage RESOL** (DeltaSol et les autres appareils du VBus)
par l'API HTTP locale d'un **KM2**, **DL2**, **DL2Plus** ou **DL3** sur votre
réseau. **Lecture seule** : elle ne change jamais un réglage. Sans cloud :
VBus.net n'est jamais contacté.

**Jamais testé avec un vrai appareil** : construite à partir de l'API telle que
l'utilise l'intégration Home Assistant hass-Deltasol-KM2 et de la
documentation du format DLx. Vos retours sont les bienvenus.

## Appareils pris en charge

- **KM2** et **DL2Plus** : identifiant et mot de passe de l'interface web
  nécessaires ;
- **DL2** et **DL3** : mot de passe seulement si l'enregistreur ne laisse pas
  un invité lire les données en direct ; un filtre défini sur l'enregistreur
  peut être utilisé ;
- **KM1** (ancien) et adaptateurs **VBus/LAN** ou **VBus/USB** : pas
  directement. Ils fonctionnent à travers le `json-live-data-server` de
  resol-vbus, qui se présente comme un DL2 (port 3333, sans mot de passe).

## Ce que vous obtenez

Un appareil par régulateur ou module présent sur le VBus (nommé d'après lui,
ex. `RESOL DeltaSol MX [Regler]`), avec les valeurs que l'enregistreur
annonce, **sous les noms de son fichier de spécification VBus (VSF)**, dans
sa langue (gardez le VSF à jour) :

- températures (°C ; un capteur coupé, 888,8 °C, ou en court-circuit,
  -888,8 °C, n'est jamais publié) ;
- pressions (bar) ;
- vitesses des pompes (%), débits (l/h), puissances (W), rayonnement
  (W/m²)… : l'unité est dans le nom ;
- **compteurs à vie** : quantités de chaleur (kWh, « lifetime » dans le nom)
  et heures de fonctionnement (h) ;
- compteurs d'une période (aujourd'hui, semaine, mois, année) : de simples
  capteurs, qui reviennent à 0 normalement.

Les valeurs sans unité (masques d'erreur, versions, dates, heures du jour)
ne sont pas publiées. Les quantités de chaleur sont de la **chaleur**, pas de
l'électricité : elles ne vont jamais au suivi énergétique de Gladys (elles y
seraient comptées comme de l'électricité).

## Configuration

1. Donnez au KM2 / DL2 / DL3 une adresse fixe dans votre box.
2. Dans Gladys, installez l'intégration et remplissez :
   - **Adresse** : son adresse IP ; ajoutez un port seulement s'il n'est pas
     80 (`:3333` pour le json-live-data-server). `https://` est refusé :
     l'appareil répond en HTTP simple ;
   - **Identifiant** : celui de l'interface web (`admin` par défaut) ;
   - **Mot de passe** : celui de l'interface web (voir plus haut) ;
   - **Filtre** (DL2 / DL3, facultatif) : l'identifiant d'un filtre de
     l'enregistreur ;
   - **Intervalle de lecture** : 60 s par défaut (60 à 900).
3. Cliquez sur **Tester la connexion**, puis créez les appareils depuis
   l'onglet **Découverte**.

## Comment il lit

Chaque lecture demande d'abord l'identité de l'appareil
(`get_resol_device_information` : produit et numéro de série), puis les
données en direct : sur un KM2 ou un DL2Plus, une connexion JSON-RPC avec
l'identifiant et le mot de passe puis `dataGetCurrentData` ; sur un DL2 ou un
DL3, `/dlx/download/live` (l'enregistreur prend l'identifiant et le mot de
passe dans l'adresse de la requête : c'est son API). Une lecture à la fois,
jamais plus vite que l'intervalle : ni au bouton de test, ni à la Découverte,
ni à une reconnexion, ni après un redémarrage du conteneur (il attend
l'intervalle plus une minute après la dernière lecture). Une nouvelle adresse,
un nouvel identifiant ou un nouveau mot de passe est lu tout de suite.

- **Identifiant ou mot de passe refusé** (HTTP 401 ou 403, ou erreur à la
  connexion JSON-RPC) : les lectures s'arrêtent jusqu'à l'enregistrement de
  nouveaux identifiants ou un clic sur **Tester la connexion** (un essai par
  clic). Un appareil injoignable, une absence de réponse, une réponse
  inattendue, un filtre inconnu ou un KM2 sans mot de passe n'est pas un
  refus : nouvel essai après 1 min, puis jusqu'à toutes les 15 min.
- **Identité** : les valeurs ne vont qu'aux appareils du numéro de série lu
  dans la même lecture. Un autre numéro de série à la même adresse a ses
  propres appareils.
- **Valeurs figées** : un paquet VBus dont l'horodatage ne bouge plus depuis
  15 min (le régulateur ne l'envoie plus) n'est plus publié ; l'état le
  signale.
- Une valeur que l'appareil marque comme absente (texte vide) n'est jamais
  publiée comme 0.

## Compteurs à vie

Une quantité de chaleur ou un compteur d'heures ne fait que monter. Chaque
compteur passe par une garde :

- 0, une valeur manquante ou un texte n'est jamais publié ;
- une **baisse** (remise à zéro, régulateur remplacé) ou un **saut** (plus de
  200 kW en moyenne plus 2 kWh pour la chaleur, plus d'une heure par heure plus
  2 h pour les heures) depuis la dernière valeur est **retenu** : la dernière
  valeur acceptée est renvoyée, l'état l'affiche, et le temps ne le confirme
  jamais (la garde compte le temps écoulé de l'intégration : une horloge
  corrigée pendant qu'elle tourne n'y change rien ; à son redémarrage, elle
  repart de l'heure du système, et une date enregistrée dans le futur est
  ramenée à maintenant) ;
- s'il est juste, cliquez deux fois sur **Accepter le compteur retenu** (le
  premier clic liste, le second, de 3 s à 5 min plus tard, accepte exactement
  ce qui a été listé). Enregistrer la configuration n'accepte rien.

Un compteur de période dont le nom n'est pas reconnu (les mots « aujourd'hui »,
« semaine », « mois », « année » en français, anglais, allemand, italien,
néerlandais et espagnol) est traité comme un compteur à vie : sa remise à 0
est alors retenue, jamais publiée comme une baisse.

## Confidentialité et sécurité

Le mot de passe est gardé par Gladys dans sa base, jamais réaffiché, envoyé
seulement à l'appareil sur votre réseau. Il n'est jamais écrit dans les
journaux, dans `/data` ni dans un état. Après un refus, `/data` garde une
empreinte salée de 8 bits (pour voir après un redémarrage si le formulaire a
changé), effacée à la lecture réussie suivante. La connexion est en HTTP
simple sur votre réseau, comme l'interface web de l'appareil.

## Limites

- Un KM2 / DL2 / DL3 par intégration.
- Aucune commande (lecture seule).
- Les noms des valeurs sont ceux du VSF de l'appareil : ni traduits ni
  devinés.
