// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

const channels = [
  'setup:status', 'setup:complete',
  'auth:login', 'auth:logout', 'auth:session', 'auth:changePassword', 'auth:updateProfile',
  'settings:get', 'settings:update',
  'clients:list', 'clients:create', 'clients:update', 'clients:delete', 'clients:historique',
  'fournisseurs:list', 'fournisseurs:create', 'fournisseurs:update', 'fournisseurs:delete',
  'categories:list', 'categories:create', 'categories:delete',
  'planComptable:list', 'planComptable:statutValidation', 'planComptable:update', 'planComptable:validerParComptable',
  'produits:list', 'produits:create', 'produits:update', 'produits:delete', 'produits:ajusterStock',
  'stocks:mouvements', 'stocks:alertes',
  'recettes:list', 'recettes:getActiveByCible', 'recettes:create', 'recettes:update', 'recettes:delete',
  'consommations:simuler',
  'achats:list', 'achats:create', 'achats:annuler', 'achats:payer', 'achats:supprimer',
  'ventes:list', 'ventes:create', 'ventes:annuler', 'ventes:payer', 'ventes:supprimer', 'ventes:modifierClient',
  'proformas:list', 'proformas:create', 'proformas:get', 'proformas:update', 'proformas:valider', 'proformas:supprimer', 'proformas:modifierClient',
  'livraisons:list', 'livraisons:create', 'livraisons:supprimer',
  'services:list', 'services:create', 'services:update', 'services:delete',
  'prestations:list', 'prestations:create', 'prestations:annuler', 'prestations:supprimer',
  'depenses:list', 'depenses:create', 'depenses:delete',
  'tresorerie:resume',
  'dashboard:stats',
  'utilisateurs:list', 'utilisateurs:create', 'utilisateurs:update', 'utilisateurs:resetPassword', 'utilisateurs:delete',
  'journal:list',
  'rapports:generer', 'rapports:exporterCsv', 'rapports:exporterComptableXlsx',
  'backup:create', 'backup:restore',
  'import:produits','import:services',
  'app:openPath','email:configure',
  'email:config:get',
  'email:recipients:list','email:recipients:add','email:recipients:remove','email:backup:send',
  'settings:logo'
];

const api = {};
channels.forEach((ch) => {
  api[ch] = (payload) => ipcRenderer.invoke(ch, payload);
});

contextBridge.exposeInMainWorld('api', api);