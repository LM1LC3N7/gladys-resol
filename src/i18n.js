// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They never
// quote a secret nor the user name: only our own words, error codes, the
// address, and the product, serial number and version of the device and the
// names of its values (cleaned by src/resol/model.js).
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const hours = (ms) => Math.max(1, Math.round(ms / 3_600_000));
export const delay = (ms) => {
  // Decided on the rounded seconds: 59.99 s is "1 min", never "60 s".
  const s = Math.round(ms / 1000);
  if (s >= 2 * 3600) return { en: `${hours(ms)} h`, fr: `${hours(ms)} h` };
  if (s >= 60) return { en: `${minutes(ms)} min`, fr: `${minutes(ms)} min` };
  return { en: `${seconds(ms)} s`, fr: `${seconds(ms)} s` };
};

/** "18:02:05 UTC": an instant, never in the local time of a container. */
export const clock = (at) => `${new Date(at).toISOString().slice(11, 19)} UTC`;

/** Our words for an error code of src/resol/client.js. */
const REASON = {
  unreachable: { en: 'unreachable', fr: 'injoignable' },
  timeout: { en: 'no answer in time', fr: 'pas de réponse à temps' },
  closed: { en: 'connection closed by the device', fr: 'connexion fermée par l’appareil' },
  not_resol: {
    en: 'no RESOL KM2, DL2, DL2Plus nor DL3 at this address (a KM1 or a VBus/LAN adapter needs the resol-vbus json-live-data-server)',
    fr: 'aucun KM2, DL2, DL2Plus ni DL3 RESOL à cette adresse (un KM1 ou un adaptateur VBus/LAN a besoin du json-live-data-server de resol-vbus)',
  },
  unsupported: {
    en: 'RESOL product not read by this integration (KM2, DL2, DL2Plus and DL3 only)',
    fr: 'produit RESOL non lu par cette intégration (KM2, DL2, DL2Plus et DL3 seulement)',
  },
  protocol: {
    en: 'answer that is not the RESOL API (is it the right address and port?)',
    fr: 'réponse qui n’est pas l’API RESOL (est-ce la bonne adresse et le bon port ?)',
  },
  password_needed: {
    en: 'a KM2 or DL2Plus needs the user name and the password of its web interface',
    fr: 'un KM2 ou un DL2Plus a besoin de l’identifiant et du mot de passe de son interface web',
  },
  refused: { en: 'user name or password refused', fr: 'identifiant ou mot de passe refusé' },
  password_asked: {
    en: 'the device asks for a user name and a password: enter those of its web interface',
    fr: 'l’appareil demande un identifiant et un mot de passe : saisissez ceux de son interface web',
  },
  denied: {
    en: 'log-in accepted, but the values were refused (user rights?)',
    fr: 'connexion acceptée, mais les valeurs ont été refusées (droits de l’utilisateur ?)',
  },
  filter: {
    en: 'the data logger does not know this filter (check its id, or leave the field empty)',
    fr: 'l’enregistreur ne connaît pas ce filtre (vérifiez son identifiant, ou laissez le champ vide)',
  },
  http: { en: 'unexpected HTTP answer', fr: 'réponse HTTP inattendue' },
  size: { en: 'answer too large', fr: 'réponse trop grande' },
  busy: { en: 'a read is already running', fr: 'une lecture est déjà en cours' },
  aborted: { en: 'read stopped', fr: 'lecture arrêtée' },
};

export function reason(err) {
  const base = REASON[err?.code] ?? { en: 'unexpected error', fr: 'erreur inattendue' };
  if (err?.code === 'http' && Number.isInteger(err.status)) {
    return { en: `${base.en} (${err.status})`, fr: `${base.fr} (${err.status})` };
  }
  return base;
}

const UNIT_OF_KIND = { energy: 'kWh', hours: 'h', volume_l: 'l', volume_m3: 'm³' };

/** A counter value with its unit: kWh, h, l or m³ (3 decimals at most). */
const amount = (value, kind) => `${Math.round(value * 1000) / 1000} ${UNIT_OF_KIND[kind] ?? 'kWh'}`;

const sentences = (lang, list) => list.map((n) => n[lang]).join(' ');
const both = (list) => ({ en: sentences('en', list), fr: sentences('fr', list) });

const heldLine = ({ name, kind, direction, from, to }) =>
  direction === 'down'
    ? {
        en: `Counter "${name}": dropped from ${amount(from, kind)} to ${amount(to, kind)}, held back (the last accepted value is sent again).`,
        fr: `Compteur « ${name} » : baisse de ${amount(from, kind)} à ${amount(to, kind)}, retenue (la dernière valeur acceptée est renvoyée).`,
      }
    : {
        en: `Counter "${name}": jumped from ${amount(from, kind)} to ${amount(to, kind)}, held back (the last accepted value is sent again).`,
        fr: `Compteur « ${name} » : saut de ${amount(from, kind)} à ${amount(to, kind)}, retenu (la dernière valeur acceptée est renvoyée).`,
      };

/** At most this many held counters are listed in a status (the others are counted). */
const LISTED = 5;

const heldLines = (held) => [
  ...held.slice(0, LISTED).map(heldLine),
  ...(held.length > LISTED
    ? [
        {
          en: `And ${held.length - LISTED} other counters held back.`,
          fr: `Et ${held.length - LISTED} autres compteurs retenus.`,
        },
      ]
    : []),
];

const product = (info) => (info?.product ? info.product.toUpperCase() : 'RESOL');

export const T = {
  problem: {
    address_missing: {
      en: 'Enter the IP address of the RESOL KM2, DL2, DL2Plus or DL3 in the configuration.',
      fr: 'Saisissez l’adresse IP du KM2, DL2, DL2Plus ou DL3 RESOL dans la configuration.',
    },
    address_invalid: {
      en: 'The address is not valid: enter an IP address or a host name, with an optional port (e.g. 192.168.1.70).',
      fr: 'L’adresse n’est pas valide : saisissez une adresse IP ou un nom d’hôte, avec un port éventuel (ex. 192.168.1.70).',
    },
    address_https: {
      en: 'The address must not start with https://: this integration only speaks plain HTTP (the password would leave unprotected where you expect HTTPS). Enter the IP address only.',
      fr: 'L’adresse ne doit pas commencer par https:// : cette intégration ne parle qu’en HTTP simple (le mot de passe partirait sans protection là où vous attendez du HTTPS). Saisissez seulement l’adresse IP.',
    },
    username_invalid: {
      en: 'The user name is not valid (at most 64 characters, no control character). Leave it empty for "admin".',
      fr: 'L’identifiant n’est pas valide (64 caractères au plus, sans caractère de contrôle). Laissez-le vide pour « admin ».',
    },
    password_invalid: {
      en: 'The password is not valid (at most 128 characters, no control character).',
      fr: 'Le mot de passe n’est pas valide (128 caractères au plus, sans caractère de contrôle).',
    },
    filter_invalid: {
      en: 'The filter is not valid: the id of a filter of the DL2 / DL3 (letters, digits, - and _), or nothing.',
      fr: 'Le filtre n’est pas valide : l’identifiant d’un filtre du DL2 / DL3 (lettres, chiffres, - et _), ou rien.',
    },
  },
  connecting: {
    en: 'Reading the RESOL device…',
    fr: 'Lecture de l’appareil RESOL…',
  },
  /** getConfig() failed in `connected`: asked again without end. */
  configRetry: (wait) => ({
    en: `The configuration could not be read from Gladys: new try in ${delay(wait).en}.`,
    fr: `La configuration n’a pas pu être lue depuis Gladys : nouvel essai dans ${delay(wait).fr}.`,
  }),
  /** Not read yet in this start: the next read. */
  waiting: (at) => ({
    en: `RESOL: next read at ${clock(at)}.`,
    fr: `RESOL : prochaine lecture à ${clock(at)}.`,
  }),
  refused: (address, asked = false) =>
    asked
      ? {
          en: `${address} asks for a user name and a password (none is set): enter those of its web interface in the configuration, then save it. Reads stopped until then (the "Test the connection" button tries once).`,
          fr: `${address} demande un identifiant et un mot de passe (aucun n’est saisi) : saisissez ceux de son interface web dans la configuration, puis enregistrez-la. Lectures arrêtées d’ici là (le bouton « Tester la connexion » fait un essai).`,
        }
      : {
          en: `${address} refuses the user name or the password: check them, then save the configuration again. Reads stopped until then (the "Test the connection" button tries once).`,
          fr: `${address} refuse l’identifiant ou le mot de passe : vérifiez-les, puis enregistrez de nouveau la configuration. Lectures arrêtées d’ici là (le bouton « Tester la connexion » fait un essai).`,
        },
  failing: (address, err, wait) => ({
    en: `${address} could not be read (${reason(err).en}): new try in ${delay(wait).en}.`,
    fr: `${address} n’a pas pu être lu (${reason(err).fr}) : nouvel essai dans ${delay(wait).fr}.`,
  }),
  ok: (info, read, notes = []) =>
    both([
      {
        en: `${product(info)} ${info?.serial ?? '?'} answering${info?.version ? ` (version ${info.version})` : ''}: ${read} VBus device(s) read.`,
        fr: `${product(info)} ${info?.serial ?? '?'} répond${info?.version ? ` (version ${info.version})` : ''} : ${read} appareil(s) VBus lu(s).`,
      },
      ...notes,
    ]),
  notes: {
    noDevice: {
      en: 'Create its devices from the "Discover" tab to receive their values.',
      fr: 'Créez ses appareils depuis l’onglet « Découverte » pour recevoir leurs valeurs.',
    },
    noPacket: {
      en: 'The answer holds no VBus device with a value: is the controller connected to the VBus of the data logger, and its VSF up to date?',
      fr: 'La réponse ne contient aucun appareil VBus avec une valeur : le régulateur est-il relié au VBus de l’enregistreur, et son VSF à jour ?',
    },
    stale: (count) => ({
      en: `${count} VBus device(s) not heard for 15 min: their values are no longer sent.`,
      fr: `${count} appareil(s) VBus sans nouvelle depuis 15 min : leurs valeurs ne sont plus envoyées.`,
    }),
    otherSerial: {
      en: 'Another serial number answers at this address: its own devices are in Discovery, the old ones get no value.',
      fr: 'Un autre numéro de série répond à cette adresse : ses propres appareils sont dans la Découverte, les anciens ne reçoivent plus de valeur.',
    },
    storeUnreadable: {
      en: 'The file of the integration in /data cannot be read: it is left as it is, and the lifetime counters are not sent until it can be read again (restart the integration).',
      fr: 'Le fichier de l’intégration dans /data est illisible : il est laissé tel quel, et les compteurs à vie ne sont pas envoyés tant qu’il ne peut pas être relu (redémarrez l’intégration).',
    },
    storeFailed: {
      en: 'The file of the integration in /data cannot be written: the lifetime counters are not sent meanwhile; the other values are.',
      fr: 'Le fichier de l’intégration dans /data ne peut pas être écrit : les compteurs à vie ne sont pas envoyés entre-temps ; les autres valeurs le sont.',
    },
    held: (held) =>
      both([
        ...heldLines(held),
        {
          en: 'A drop or a jump is never taken by itself. If the counter was really reset or the controller replaced (or the jump is right), click "Accept the held counter" twice in the configuration of the integration (the first click lists, the second accepts exactly what was listed). Saving the configuration accepts nothing.',
          fr: 'Une baisse ou un saut n’est jamais pris de lui-même. Si le compteur a vraiment été remis à zéro ou le régulateur remplacé (ou si le saut est juste), cliquez deux fois sur « Accepter le compteur retenu » dans la configuration de l’intégration (le premier clic liste, le second accepte exactement ce qui a été listé). Enregistrer la configuration n’accepte rien.',
        },
      ]),
  },
  accept: {
    nothing: {
      en: 'No counter is held back: nothing to accept.',
      fr: 'Aucun compteur n’est retenu : rien à accepter.',
    },
    confirm: (held, within) =>
      both([
        {
          en: 'A second click accepts exactly these values:',
          fr: 'Un second clic accepte exactement ces valeurs :',
        },
        ...held.map((h) =>
          h.direction === 'down'
            ? {
                en: `${h.name}: ${amount(h.from, h.kind)} → ${amount(h.to, h.kind)} (a reset or a new controller: the counter goes on from ${amount(h.to, h.kind)}).`,
                fr: `${h.name} : ${amount(h.from, h.kind)} → ${amount(h.to, h.kind)} (remise à zéro ou nouveau régulateur : le compteur reprend à ${amount(h.to, h.kind)}).`,
              }
            : {
                en: `${h.name}: ${amount(h.from, h.kind)} → ${amount(h.to, h.kind)} (a jump of ${amount(h.to - h.from, h.kind)}).`,
                fr: `${h.name} : ${amount(h.from, h.kind)} → ${amount(h.to, h.kind)} (un saut de ${amount(h.to - h.from, h.kind)}).`,
              },
        ),
        {
          en: `Click "Accept the held counter" again, after a few seconds and within ${delay(within).en}, to accept them; accept only if this is real.`,
          fr: `Cliquez de nouveau sur « Accepter le compteur retenu », après quelques secondes et dans les ${delay(within).fr}, pour les accepter ; n’acceptez que si c’est réel.`,
        },
      ]),
    done: (accepted, changed, stillHeld) =>
      both([
        ...accepted.map((h) => ({
          en: `Accepted: ${h.name} ${amount(h.to, h.kind)}, sent at the next read.`,
          fr: `Accepté : ${h.name} ${amount(h.to, h.kind)}, envoyé à la prochaine lecture.`,
        })),
        ...(changed.length > 0
          ? [
              {
                en: `Not accepted, the value changed since the first click: ${changed.map((h) => h.name).join('; ')}. Click again to list it.`,
                fr: `Non accepté, la valeur a changé depuis le premier clic : ${changed.map((h) => h.name).join(' ; ')}. Cliquez de nouveau pour la lister.`,
              },
            ]
          : []),
        ...(stillHeld
          ? [{ en: 'A different value stays held.', fr: 'Une autre valeur reste retenue.' }]
          : []),
      ]),
  },
  test: {
    ok: (address, info, read) => ({
      en: `${address}: ${product(info)} ${info?.serial ?? '?'}${info?.version ? `, version ${info.version}` : ''}, ${read} VBus device(s) read.`,
      fr: `${address} : ${product(info)} ${info?.serial ?? '?'}${info?.version ? `, version ${info.version}` : ''}, ${read} appareil(s) VBus lu(s).`,
    }),
    failed: (address, err) => ({
      en: `${address}: ${reason(err).en}.`,
      fr: `${address} : ${reason(err).fr}.`,
    }),
    /** The button never reads sooner than the pace: what is known, and when the next read can be. */
    notNow: (at) => ({
      en: `Not asked now (never faster than the reading interval): next read possible at ${clock(at)}.`,
      fr: `Non interrogé maintenant (jamais plus vite que l’intervalle de lecture) : prochaine lecture possible à ${clock(at)}.`,
    }),
    lastRead: (at) => ({
      en: `Last read at ${clock(at)}.`,
      fr: `Dernière lecture à ${clock(at)}.`,
    }),
    slow: {
      en: 'The device is slow to answer: look at the integration status in a minute.',
      fr: 'L’appareil tarde à répondre : regardez l’état de l’intégration dans une minute.',
    },
    lines: (lines) => both(lines),
  },
};
