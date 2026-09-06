export function createCombobox(options, selectedId, placeholder = 'Rechercher...') {
  const wrapper = document.createElement('div');
  wrapper.className = 'combobox-wrapper';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.className = 'combobox-input';
  input.autocomplete = 'off';

  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  hidden.className = 'combobox-hidden';
  hidden.value = selectedId || '';

  const dropdown = document.createElement('div');
  dropdown.className = 'combobox-dropdown';

  wrapper.appendChild(input);
  wrapper.appendChild(hidden);
  wrapper.appendChild(dropdown);

  function renderOptions(query) {
    const q = (query || '').trim().toLowerCase();
    const matches = (q ? options.filter(o => o.label.toLowerCase().includes(q)) : options).slice(0, 200);
    dropdown.innerHTML = '';
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'combobox-empty';
      empty.textContent = 'Aucun résultat — utilisez le bouton « ➕ Nouveau » pour en créer un';
      dropdown.appendChild(empty);
      return;
    }
    matches.forEach((opt) => {
      const item = document.createElement('div');
      item.className = 'combobox-option';
      item.textContent = opt.label;
      item.dataset.id = opt.id;
      item.dataset.prix = opt.prix != null ? opt.prix : '';
      // mousedown (et non click) pour s'exécuter avant le "blur" de l'input qui referme la liste
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = opt.label;
        hidden.value = opt.id;
        closeDropdown();
        // BUGFIX CRITIQUE : on notifie la sélection avec l'événement natif "change"
        // et NON "input". Le listener juste en dessous (qui vide hidden.value à
        // chaque frappe, pour empêcher qu'un texte libre non sélectionné soit pris
        // pour un produit/service existant) écoute justement l'événement "input" —
        // en le déclenchant nous-mêmes ici après avoir choisi une option, on
        // effaçait donc INSTANTANÉMENT la sélection qu'on venait de faire : la
        // recherche semblait "ne rien faire" au clic, car hidden.value repassait à
        // '' aussitôt. "change" est un événement distinct, non intercepté par ce
        // listener, qui notifie correctement recalcTotal (voir addLigne) sans
        // invalider la sélection qu'il vient de confirmer.
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      dropdown.appendChild(item);
    });
  }

  function openDropdown() { positionDropdown(); renderOptions(input.value); dropdown.classList.add('open'); window.addEventListener('scroll', positionDropdown, true); window.addEventListener('resize', positionDropdown); }
  function closeDropdown() { dropdown.classList.remove('open'); window.removeEventListener('scroll', positionDropdown, true); window.removeEventListener('resize', positionDropdown); }
  // BUGFIX : la liste ne s'affichait auparavant que sur ~2 résultats visibles avant
  // d'être coupée. Cause réelle : le menu était positionné en "absolute" à
  // l'intérieur de la ligne, elle-même dans des conteneurs à défilement
  // (le tableau d'articles, puis la fenêtre elle-même) — tout élément "absolute"
  // reste soumis au découpage ("overflow: hidden/auto") de CES ancêtres, qui
  // rognait donc le menu bien avant sa hauteur maximale réelle. En le
  // positionnant en "fixed" (calculé ici en JS par rapport à la position réelle
  // du champ à l'écran), le menu échappe à ce découpage et affiche sa pleine
  // hauteur, quel que soit l'endroit du formulaire où se trouve la ligne.
  function positionDropdown() {
    const rect = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < 180 && rect.top > spaceBelow;
    dropdown.style.left = Math.round(rect.left) + 'px';
    dropdown.style.width = Math.round(rect.width) + 'px';
    if (openUpward) {
      dropdown.style.top = '';
      dropdown.style.bottom = Math.round(window.innerHeight - rect.top + 4) + 'px';
      dropdown.style.maxHeight = Math.min(320, Math.max(120, rect.top - 12)) + 'px';
    } else {
      dropdown.style.bottom = '';
      dropdown.style.top = Math.round(rect.bottom + 4) + 'px';
      dropdown.style.maxHeight = Math.min(320, Math.max(120, spaceBelow - 12)) + 'px';
    }
  }

  input.addEventListener('focus', openDropdown);
  input.addEventListener('input', () => {
    // Toute frappe invalide la sélection précédente tant qu'une option n'est pas
    // re-choisie dans la liste : impossible désormais de "glisser" un texte libre
    // comme s'il correspondait à un produit/service existant.
    hidden.value = '';
    renderOptions(input.value);
    dropdown.classList.add('open');
  });
  input.addEventListener('blur', () => {
    // Léger délai pour laisser le mousedown sur une option s'exécuter avant fermeture
    setTimeout(closeDropdown, 150);
  });

  // Pré-sélection initiale (mode édition)
  if (selectedId) {
    const selectedOpt = options.find(o => String(o.id) === String(selectedId));
    if (selectedOpt) {
      input.value = selectedOpt.label;
      hidden.value = selectedOpt.id;
    }
  }

  return wrapper;
}

// Résout le nom à afficher pour une vente/prestation : client enregistré >
// nom saisi manuellement > « Client comptoir » par défaut.
