import { mk } from './q'

// Lot 2 (2026-11-22) : ajouté en fin de banque pour garder les identifiants existants.
export const CULTURE_2 = mk('culture', [
  // difficulté 1
  ['Combien de cordes compte une guitare classique ?', 6, 'cordes', 1],
  ['Combien de cordes compte un violon ?', 4, 'cordes', 1],
  ['Combien de notes différentes compte la gamme de do majeur (do, ré, mi…) ?', 7, 'notes', 1],
  ['Combien de membres comptaient les Beatles ?', 4, 'membres', 1],
  ['En quelle année est sorti au cinéma le premier film « Star Wars » ?', 1977, '', 1],
  ['En combien de jours Phileas Fogg fait-il le tour du monde dans le roman de Jules Verne ?', 80, 'jours', 1],
  ['Combien de lieues sous les mers annonce le titre du célèbre roman de Jules Verne ?', 20000, 'lieues', 1],
  ['En quelle année Johnny Hallyday est-il mort ?', 2017, '', 1],
  ['Combien de films compte la saga « Harry Potter » au cinéma ?', 8, 'films', 1, 'Le dernier tome a été adapté en deux films.'],
  ['En quelle année Disneyland Paris a-t-il ouvert ses portes ?', 1992, '', 1],
  ['Combien d’étoiles au maximum un restaurant peut-il obtenir au Guide Michelin ?', 3, 'étoiles', 1],
  ['En quelle année est sorti le dessin animé « Le Roi lion » de Disney ?', 1994, '', 1],
  // difficulté 2
  ['En quelle année la pyramide du Louvre a-t-elle été ouverte au public ?', 1989, '', 2],
  ['En quelle année est sorti l’album « Thriller » de Michael Jackson ?', 1982, '', 2],
  ['Quelle est la hauteur de la statue du Christ Rédempteur à Rio de Janeiro, sans son piédestal ?', 30, 'm', 2, 'Environ 30 m, plus 8 m de piédestal.'],
  ['En quelle année Molière est-il mort ?', 1673, '', 2],
  ['En quelle année Victor Hugo est-il mort ?', 1885, '', 2],
  ['Quelle est la hauteur de la tour de Pise ?', 56, 'm', 2, 'Environ 56 m.'],
  ['Quelle est la hauteur de la tour de Big Ben (tour Elizabeth) à Londres ?', 96, 'm', 2, 'Environ 96 m.'],
  ['Combien de saisons compte la série « Friends » ?', 10, 'saisons', 2],
  ['En quelle année Astérix est-il apparu pour la première fois, dans le journal Pilote ?', 1959, '', 2],
  ['Quelle est la hauteur de la tour Montparnasse à Paris ?', 210, 'm', 2, 'Environ 210 m.'],
  ['Combien de touches noires compte un piano standard ?', 36, 'touches', 2, '36 noires et 52 blanches.'],
  ['En quelle année est sorti « Toy Story », premier long métrage entièrement en images de synthèse ?', 1995, '', 2],
  // difficulté 3
  ['Quelle est la longueur de la galerie des Glaces du château de Versailles ?', 73, 'm', 3, 'Environ 73 m.'],
  ['En quelle année le Colisée de Rome a-t-il été inauguré ?', 80, '', 3, 'En l’an 80 après J.-C., sous l’empereur Titus.'],
  ['Combien de statues moaï ont été recensées sur l’île de Pâques ?', 887, 'statues', 3, 'Environ 900 ; 887 selon l’inventaire de référence.'],
  ['En quelle année « La Joconde » a-t-elle été volée au Louvre ?', 1911, '', 3, 'Elle a été retrouvée en Italie en 1913.'],
  ['Combien de mouvements comptent au total « Les Quatre Saisons » de Vivaldi ?', 12, 'mouvements', 3, 'Quatre concertos de trois mouvements.'],
  ['Dans combien de films officiels de James Bond Sean Connery a-t-il joué 007 ?', 6, 'films', 3, 'Sans compter « Jamais plus jamais » (1983), hors série officielle.'],
])
