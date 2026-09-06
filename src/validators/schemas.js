// src/validators/schemas.js

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).toLowerCase());
}

// Schéma pour un produit
function validateProduit(data) {
  const errors = [];
  if (!data.designation || data.designation.trim().length < 2) {
    errors.push('La désignation doit contenir au moins 2 caractères');
  }
  if (data.prixAchat !== undefined && isNaN(Number(data.prixAchat))) {
    errors.push('Le prix d\'achat doit être un nombre valide');
  }
  if (data.prixAchat !== undefined && !isNaN(Number(data.prixAchat)) && Number(data.prixAchat) < 0) {
    errors.push('Le prix d\'achat ne peut pas être négatif');
  }
  if (data.prixVente !== undefined && isNaN(Number(data.prixVente))) {
    errors.push('Le prix de vente doit être un nombre valide');
  }
  if (data.prixVente !== undefined && !isNaN(Number(data.prixVente)) && Number(data.prixVente) < 0) {
    errors.push('Le prix de vente ne peut pas être négatif');
  }
  if (data.quantite !== undefined && isNaN(Number(data.quantite))) {
    errors.push('La quantité doit être un nombre valide');
  }
  if (data.quantite !== undefined && Number(data.quantite) < 0) {
    errors.push('La quantité ne peut pas être négative');
  }
  if (data.seuilMin !== undefined && isNaN(Number(data.seuilMin))) {
    errors.push('Le seuil minimum doit être un nombre valide');
  }
  if (data.seuilMin !== undefined && !isNaN(Number(data.seuilMin)) && Number(data.seuilMin) < 0) {
    errors.push('Le seuil minimum ne peut pas être négatif');
  }
  return errors;
}

// Schéma pour un client
function validateClient(data) {
  const errors = [];
  if (!data.nom || data.nom.trim().length < 2) {
    errors.push('Le nom du client doit contenir au moins 2 caractères');
  }
  if (data.email && !isValidEmail(data.email)) {
    errors.push('L\'adresse e-mail n\'est pas valide');
  }
  return errors;
}

// Schéma pour une vente
function validateVente(data) {
  const errors = [];
  if (!data.items || data.items.length === 0) {
    errors.push('Ajoutez au moins un article à la vente');
  }
  if (data.items) {
    data.items.forEach((item, index) => {
      if (item.nouveau && (!item.nom || item.nom.trim().length < 2)) {
        errors.push(`Ligne ${index + 1} : le nom du nouvel article est requis`);
      }
      if (!item.nouveau && !item.produitId && !item.serviceId) {
        errors.push(`Ligne ${index + 1} : aucun article sélectionné`);
      }
      if (isNaN(Number(item.quantite)) || Number(item.quantite) <= 0) {
        errors.push(`Ligne ${index + 1} : quantité invalide`);
      }
    });
  }
  return errors;
}

// Schéma pour un achat
function validateAchat(data) {
  const errors = [];
  if (!data.fournisseurId) {
    errors.push('Le fournisseur est requis');
  }
  if (!data.lignes || data.lignes.length === 0) {
    errors.push('Ajoutez au moins un article à l\'achat');
  }
  if (data.lignes) {
    data.lignes.forEach((l, index) => {
      if (!l.produitId) {
        errors.push(`Ligne ${index + 1} : produit manquant`);
      }
      if (isNaN(Number(l.quantite)) || Number(l.quantite) <= 0) {
        errors.push(`Ligne ${index + 1} : quantité invalide`);
      }
      if (isNaN(Number(l.prixUnitaire)) || Number(l.prixUnitaire) < 0) {
        errors.push(`Ligne ${index + 1} : prix unitaire invalide`);
      }
    });
  }
  return errors;
}

// Schéma pour un fournisseur
function validateFournisseur(data) {
  const errors = [];
  if (!data.nom || data.nom.trim().length < 2) {
    errors.push('Le nom du fournisseur doit contenir au moins 2 caractères');
  }
  if (data.email && !isValidEmail(data.email)) {
    errors.push('L\'adresse e-mail n\'est pas valide');
  }
  return errors;
}

// Schéma pour un utilisateur
function validateUtilisateur(data) {
  const errors = [];
  if (!data.nom || data.nom.trim().length < 2) {
    errors.push('Le nom doit contenir au moins 2 caractères');
  }
  if (!data.email || !isValidEmail(data.email)) {
    errors.push('L\'adresse e-mail n\'est pas valide');
  }
  
  if (data.password && data.password.length < 8) {
    errors.push('Le mot de passe doit contenir au moins 8 caractères');
  }
  if (!['admin', 'gestionnaire', 'caissier'].includes(data.role)) {
    errors.push('Rôle invalide');
  }
  return errors;
}

// Schéma pour une dépense
function validateDepense(data) {
  const errors = [];
  if (!data.categorie || data.categorie.trim().length < 2) {
    errors.push('La catégorie est requise');
  }
  if (isNaN(Number(data.montant)) || Number(data.montant) <= 0) {
    errors.push('Le montant doit être un nombre positif');
  }
  return errors;
}

// Fonction principale
function validate(type, data) {
  const validators = {
    produit: validateProduit,
    client: validateClient,
    vente: validateVente,
    achat: validateAchat,
    utilisateur: validateUtilisateur,
    depense: validateDepense,
    fournisseur: validateFournisseur
  };
  const validator = validators[type];
  if (!validator) return [];
  return validator(data);
}

module.exports = { validate, isValidEmail };