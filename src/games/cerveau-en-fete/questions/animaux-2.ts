import { build, type Row } from './_helpers'

// Lot 2 (2026-11-22) : ajouté en fin de banque pour garder les identifiants existants.
const rows: Row[] = [
  // Difficulté 1
  [1, 'Comment appelle-t-on le petit du cheval ?', 'Le poulain', 'Le veau;L’ânon;Le chevreau', 'Poulain'],
  [1, 'Comment appelle-t-on le petit de la brebis ?', 'L’agneau', 'Le chevreau;Le veau;Le porcelet', 'Agneau'],
  [1, 'Comment appelle-t-on le petit de la poule ?', 'Le poussin', 'Le caneton;L’oison;Le pigeonneau', 'Poussin'],
  [1, 'Comment appelle-t-on le petit du canard ?', 'Le caneton', 'Le poussin;Le cygneau;Le dindonneau', 'Caneton'],
  [1, 'Comment appelle-t-on le petit de l’ours ?', 'L’ourson', 'Le louveteau;Le lionceau;Le renardeau', 'Ourson'],
  [1, 'Comment appelle-t-on la femelle du cochon ?', 'La truie', 'La laie;La brebis;La jument', 'Truie'],
  [1, 'Comment appelle-t-on le mâle de la vache ?', 'Le taureau', 'Le bouc;Le bélier;Le verrat', 'Taureau'],
  [1, 'Comment appelle-t-on le cri du chien ?', 'L’aboiement', 'Le miaulement;Le hennissement;Le meuglement', 'Aboiement;Aboyer;Il aboie'],
  [1, 'Quel insecte fabrique le miel ?', 'L’abeille', 'La guêpe;La fourmi;La coccinelle', 'Abeille;Les abeilles'],
  [1, 'Comment appelle-t-on la larve du papillon ?', 'La chenille', 'Le ver de terre;Le têtard;L’asticot', 'Chenille'],
  [1, 'Quel mammifère d’Amérique du Sud vit suspendu aux branches, la tête en bas, et bouge très lentement ?', 'Le paresseux', 'Le koala;Le tatou;Le lémurien', 'Paresseux'],
  [1, 'Quel oiseau aux plumes roses se tient souvent sur une seule patte ?', 'Le flamant rose', 'La cigogne;Le héron;Le pélican', 'Flamant;Flamant rose;Flamand rose'],
  [1, 'À quelle famille d’animaux appartient le dauphin ?', 'Les mammifères', 'Les poissons;Les reptiles;Les amphibiens', 'Mammifères;Mammifère;Un mammifère'],
  [1, 'Quel animal marin a généralement cinq bras ?', 'L’étoile de mer', 'La pieuvre;La méduse;L’oursin', 'Étoile de mer;Etoile de mer'],
  [1, 'Quel rongeur construit des barrages sur les rivières ?', 'Le castor', 'Le ragondin;Le rat musqué;La marmotte', 'Castor'],
  // Difficulté 2
  [2, 'Comment appelle-t-on la larve de la grenouille ?', 'Le têtard', 'L’alevin;Le grenouillet;Le crapaudeau', 'Têtard;Tetard'],
  [2, 'Comment appelle-t-on la femelle du sanglier ?', 'La laie', 'La truie;La hase;La biche', 'Laie'],
  [2, 'Comment appelle-t-on le petit du sanglier ?', 'Le marcassin', 'Le porcelet;Le goret;Le faon', 'Marcassin'],
  [2, 'Comment appelle-t-on le petit du loup ?', 'Le louveteau', 'Le lionceau;Le renardeau;Le loupiot', 'Louveteau'],
  [2, 'Comment appelle-t-on le petit de l’âne ?', 'L’ânon', 'Le poulain;Le mulet;Le baudet', 'Ânon;Anon'],
  [2, 'Comment appelle-t-on le petit du lapin ?', 'Le lapereau', 'Le levraut;Le lapinot;Le marcassin', 'Lapereau'],
  [2, 'Comment appelle-t-on le cri du cheval ?', 'Le hennissement', 'Le braiment;Le beuglement;Le barrissement', 'Hennissement;Hennir;Il hennit'],
  [2, 'Comment appelle-t-on le cri de l’éléphant ?', 'Le barrissement', 'Le brame;Le rugissement;Le mugissement', 'Barrissement;Barrir;Il barrit'],
  [2, 'Comment appelle-t-on le cri de la grenouille ?', 'Le coassement', 'Le croassement;Le caquètement;Le gazouillis', '', 'QCM'],
  [2, 'Quel oiseau noir croasse ?', 'Le corbeau', 'La pie;Le hibou;Le pigeon', 'Corbeau;La corneille;Corneille'],
  [2, 'Quel est le plus grand lézard du monde ?', 'Le dragon de Komodo', 'L’iguane vert;Le varan du Nil;Le monstre de Gila', 'Dragon de Komodo;Varan de Komodo;Komodo'],
  [2, 'Quel est le plus gros rongeur du monde ?', 'Le capybara', 'Le castor;Le porc-épic;La marmotte', 'Capybara;Cabiai'],
  [2, 'En combien de poches (panse, bonnet…) est divisé l’estomac de la vache ?', '4', '1;2;6', 'quatre'],
  [2, 'Quel animal est surnommé « le vaisseau du désert » ?', 'Le dromadaire', 'Le zèbre;L’âne;Le lama', 'Dromadaire;Chameau;Le chameau'],
  [2, 'Quel poisson remonte les rivières pour aller pondre là où il est né ?', 'Le saumon', 'Le brochet;L’anguille;La carpe', 'Saumon'],
  // Difficulté 3
  [3, 'De quelle couleur est la peau de l’ours polaire, sous sa fourrure ?', 'Noire', 'Blanche;Rose;Grise', 'Noir'],
  [3, 'Comment appelle-t-on la femelle du lièvre ?', 'La hase', 'La lapine;La biche;La laie', 'Hase'],
  [3, 'Comment appelle-t-on le petit du phoque ?', 'Le blanchon', 'Le phoqueau;Le banquiseau;Le morseau', 'Blanchon'],
  [3, 'Comment appelle-t-on le mâle de la truie ?', 'Le verrat', 'Le sanglier;Le bélier;Le bouc', 'Verrat'],
  [3, 'Quel est le plus grand reptile vivant au monde ?', 'Le crocodile marin', 'L’anaconda vert;Le dragon de Komodo;La tortue luth', 'Crocodile marin;Crocodile de mer;Crocodile'],
  [3, 'Combien de vertèbres compte le cou d’une girafe ?', '7', '3;14;25', 'sept'],
  [3, 'Quel est le plus grand félin du continent américain ?', 'Le jaguar', 'Le puma;L’ocelot;Le lynx', 'Jaguar'],
  [3, 'Quel rapace est l’emblème national des États-Unis ?', 'Le pygargue à tête blanche', 'L’aigle royal;Le condor des Andes;Le faucon pèlerin', 'Pygargue;Pygargue à tête blanche;Aigle à tête blanche'],
  [3, 'Quel marsupial australien fait des crottes en forme de cube ?', 'Le wombat', 'Le koala;Le kangourou;Le diable de Tasmanie', 'Wombat'],
  [3, 'Combien de temps dure environ la gestation d’une éléphante ?', '22 mois', '9 mois;12 mois;36 mois', '22;Près de deux ans;Presque 2 ans'],
]

export const ANIMAUX_2 = build('animaux', rows)
