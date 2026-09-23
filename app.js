const jobForm = document.querySelector('#jobForm');
const profileForm = document.querySelector('#profileForm');
const description = document.querySelector('#jobDescription');
const cvFiles = document.querySelector('#cvFiles');
const count = document.querySelector('#fileCount');
const results = document.querySelector('#results');
const reviewButton = document.querySelector('#reviewButton');
const workflow = document.querySelector('#workflow');
const skillLabels = [
  ['accounts receivable', 'Accounts Receivable'], ['accounting', 'Accounting'], ['finance', 'Finance'], ['ifrs', 'IFRS'], ['excel', 'Excel'], ['erp', 'ERP'], ['revenue recognition', 'Revenue recognition'], ['reconciliation', 'Reconciliation'], ['collections', 'Collections'], ['audit', 'Audit'], ['treasury', 'Treasury'], ['figma', 'Figma'], ['product design', 'Product design'], ['ux design', 'UX design'], ['ui design', 'UI design'], ['react', 'React'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['python', 'Python'], ['java', 'Java'], ['sql', 'SQL'], ['aws', 'AWS'], ['project management', 'Project management']
];

function normalizeText(text) {
  return text.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;/gi, ' ').replace(/[\u2013\u2014]/g, '-');
}
function setStage(stage) {
  const stages = ['job', 'criteria', 'files', 'results'];
  const current = stages.indexOf(stage);
  workflow.querySelectorAll('li').forEach(item => {
    const index = stages.indexOf(item.dataset.step);
    item.classList.toggle('is-active', index === current);
    item.classList.toggle('is-complete', index < current);
  });
}
function selectedFiles() { return [...cvFiles.files].slice(0, 20); }
function updateFiles() {
  const files = selectedFiles();
  count.textContent = `${files.length} CV${files.length === 1 ? '' : 's'}`;
  const list = document.querySelector('#cvList');
  list.replaceChildren();
  files.forEach(file => { const item = document.createElement('span'); item.textContent = file.name; list.append(item); });
}
function setReviewBusy(isBusy) {
  reviewButton.disabled = isBusy;
  reviewButton.classList.toggle('is-busy', isBusy);
  reviewButton.querySelector('.button-label').textContent = isBusy ? 'Reading CVs...' : 'Review CVs';
}
function getTitle(text) {
  return text.split(/\r?\n/).map(line => line.trim()).find(line => line.length >= 3 && line.length <= 70 && !/^(about us|responsibilities|qualifications|benefits)$/i.test(line)) || '';
}
function extractPlan() {
  const text = normalizeText(description.value);
  const lower = text.toLowerCase();
  const title = getTitle(text);
  const cleanTitle = title.replace(/^(senior|junior|lead|principal|staff)\s+/i, '');
  const titles = lower.includes('ar accountant')
    ? ['AR Accountant', 'Accounts Receivable Accountant', 'Accounts Receivable Specialist', 'Receivables Accountant', 'Senior Accountant']
    : [title, cleanTitle].filter((value, index, values) => value && values.indexOf(value) === index);
  const location = lower.includes('cairo') || lower.includes('egypt') ? ['Cairo, Egypt'] : lower.includes('remote') ? ['Remote'] : [];
  const years = text.match(/\b\d+\s*(?:-|to)\s*\d+\s*years?\b|\b\d+\+?\s*years?\b/i)?.[0];
  const allSkills = skillLabels.filter(([term]) => lower.includes(term)).map(([, label]) => label);
  const preferred = allSkills.filter(skill => new RegExp(`${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.]{0,40}preferred|preferred[^.]{0,40}${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(text));
  if (lower.includes('real estate') && lower.includes('preferred')) preferred.push('Real estate');
  return { titles, location, experience: years ? [years] : [], required: allSkills.filter(skill => !preferred.includes(skill)), preferred: [...new Set(preferred)] };
}
function makeOption(group, value) {
  const option = document.createElement('label');
  option.className = 'criteria-option';
  const input = document.createElement('input');
  input.type = 'checkbox'; input.checked = true; input.dataset.group = group; input.value = value;
  const text = document.createElement('span'); text.textContent = value;
  option.append(input, text);
  return option;
}
function renderCriteria(criteria) {
  const groups = [['titles', 'Job titles'], ['location', 'Location'], ['experience', 'Experience'], ['required', 'Required skills'], ['preferred', 'Preferred skills']];
  const wrapper = document.createElement('div'); wrapper.className = 'criteria-groups';
  groups.forEach(([key, label]) => {
    const group = document.createElement('section'); group.className = 'criteria-group';
    const heading = document.createElement('h3'); heading.textContent = label;
    const options = document.createElement('div'); options.className = 'criteria-options';
    criteria[key].forEach(value => options.append(makeOption(key, value)));
    const add = document.createElement('div'); add.className = 'criteria-add';
    const addInput = document.createElement('input'); addInput.type = 'text'; addInput.placeholder = `Add ${label.toLowerCase().replace(/s$/, '')}`; addInput.dataset.addInput = key;
    const addButton = document.createElement('button'); addButton.type = 'button'; addButton.textContent = 'Add'; addButton.dataset.addButton = key;
    add.append(addInput, addButton); group.append(heading, options, add); wrapper.append(group);
  });
  document.querySelector('#criteriaGroups').replaceChildren(wrapper);
}
function selectedCriteria() {
  const selected = { titles: [], location: [], experience: [], required: [], preferred: [] };
  document.querySelectorAll('#criteriaGroups input:checked').forEach(input => selected[input.dataset.group].push(input.value));
  return selected;
}
function updateBooleanQuery() {
  const titles = selectedCriteria().titles;
  document.querySelector('#booleanQuery').textContent = titles.length ? `(${titles.map(title => `"${title}"`).join(' OR ')})` : 'candidate';
}
function addCriterion(group, value) {
  const cleanValue = value.trim();
  if (!cleanValue) return;
  const selected = [...document.querySelectorAll(`#criteriaGroups input[data-group="${group}"]`)];
  if (selected.some(input => input.value.toLowerCase() === cleanValue.toLowerCase())) return;
  const target = document.querySelector(`[data-add-input="${group}"]`);
  target.closest('.criteria-add').previousElementSibling.append(makeOption(group, cleanValue));
  target.value = '';
  updateBooleanQuery();
}
function renderResult(profile, index) {
  const card = document.querySelector('#resultTemplate').content.cloneNode(true);
  const root = card.querySelector('.profile-result');
  const status = card.querySelector('.result-status');
  const name = card.querySelector('h3');
  const source = card.querySelector('.candidate-source');
  const cvDetails = card.querySelector('.cv-facts');
  const score = card.querySelector('.match-panel strong');
  const scoreNote = card.querySelector('.match-panel small');
  root.style.animationDelay = `${index * 70}ms`;
  source.textContent = profile.filename;
  if (profile.status !== 'available') {
    root.classList.add('unavailable');
    status.classList.add(profile.status === 'limited' ? 'limited' : 'unavailable');
    name.textContent = profile.title || 'CV unavailable';
    card.querySelector('[data-cv="summary"] strong').textContent = profile.message;
    card.querySelector('[data-cv="summary"] span').textContent = 'Review status';
    card.querySelectorAll('[data-cv="experience"],[data-cv="education"],[data-cv="skills"]').forEach(item => item.classList.add('is-empty'));
    score.textContent = 'No score'; scoreNote.textContent = 'No readable CV text';
    return card;
  }
  root.style.setProperty('--score-progress', `${profile.score}%`);
  name.textContent = profile.title || 'Candidate';
  const details = profile.cvDetails || { summary: profile.summary || 'The CV did not expose enough summary text for a detailed review.' };
  cvDetails.querySelectorAll('[data-cv]').forEach(item => {
    const value = details[item.dataset.cv];
    item.classList.toggle('is-empty', !value);
    item.querySelector('strong').textContent = value || '';
  });
  score.textContent = `${profile.score}%`;
  scoreNote.textContent = profile.dataQuality === 'limited' ? 'Limited CV text' : 'CV evidence';
  const reasons = card.querySelector('.match-reasons');
  profile.reasons.forEach(reason => { const tag = document.createElement('span'); tag.textContent = reason; reasons.append(tag); });
  const gaps = card.querySelector('.match-gaps');
  profile.gaps.forEach(gap => { const tag = document.createElement('span'); tag.textContent = `Missing: ${gap}`; gaps.append(tag); });
  return card;
}

jobForm.addEventListener('submit', event => {
  event.preventDefault();
  renderCriteria(extractPlan()); updateBooleanQuery(); setStage('criteria');
  document.querySelector('#criteriaStep').classList.remove('hidden');
  profileForm.classList.add('hidden'); results.classList.add('hidden');
  document.querySelector('#criteriaStep').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.querySelector('#criteriaGroups').addEventListener('change', updateBooleanQuery);
document.querySelector('#criteriaGroups').addEventListener('click', event => {
  const key = event.target.dataset.addButton;
  if (key) addCriterion(key, document.querySelector(`[data-add-input="${key}"]`).value);
});
document.querySelector('#criteriaGroups').addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.dataset.addInput) { event.preventDefault(); addCriterion(event.target.dataset.addInput, event.target.value); }
});
document.querySelector('#copyQuery').addEventListener('click', async event => {
  await navigator.clipboard.writeText(document.querySelector('#booleanQuery').textContent);
  event.currentTarget.textContent = 'Copied';
  setTimeout(() => { event.currentTarget.textContent = 'Copy Boolean query'; }, 1500);
});
document.querySelector('#continueButton').addEventListener('click', () => {
  setStage('files'); profileForm.classList.remove('hidden');
  profileForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
profileForm.addEventListener('submit', async event => {
  event.preventDefault();
  const files = selectedFiles();
  if (!files.length) return;
  setReviewBusy(true);
  try {
    const body = new FormData();
    body.append('jobDescription', normalizeText(description.value));
    body.append('criteria', JSON.stringify(selectedCriteria()));
    files.forEach(file => body.append('cvs', file));
    const response = await fetch('/api/review-cvs', { method: 'POST', body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to review these CVs.');
    document.querySelector('#resultTitle').textContent = `${data.profiles.length} CV${data.profiles.length === 1 ? '' : 's'} reviewed`;
    document.querySelector('#criteriaSummary').textContent = data.criteria.length ? `Scored against: ${data.criteria.join(', ')}.` : 'No criteria selected.';
    const list = document.querySelector('#profileList'); list.replaceChildren();
    data.profiles.forEach((profile, index) => list.append(renderResult(profile, index)));
    setStage('results'); results.classList.remove('hidden');
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    document.querySelector('#resultTitle').textContent = 'Could not review CVs';
    document.querySelector('#criteriaSummary').textContent = error.message;
    document.querySelector('#profileList').replaceChildren();
    results.classList.remove('hidden');
  } finally { setReviewBusy(false); }
});
cvFiles.addEventListener('change', updateFiles);
setStage('job'); updateFiles();
