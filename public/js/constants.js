export const SALES_TYPES = [
  { id: 'cold_call', label: 'Cold call', blurb: 'A phone call to someone who isn\'t expecting you' },
  { id: 'door_to_door', label: 'Door to door', blurb: 'Knocking on a door, face to face' },
  { id: 'demo_call', label: 'Demo call', blurb: 'A booked call to show your product' },
];
export const CATEGORIES = ['Software / SaaS', 'Home services', 'Insurance', 'Real estate', 'Retail', 'Automotive', 'Solar / energy', 'Other'];
export const MODES = [
  { id: 'easy', label: 'Easy', name: 'Friendly Fran', blurb: 'Warm and easy to please. She agrees quickly and grades generously.' },
  { id: 'medium', label: 'Medium', name: 'Busy Ben', blurb: 'Fair but busy. He wants a reason and grades at a normal standard.' },
  { id: 'hard', label: 'Hard', name: 'Skeptical Sam', blurb: 'Guarded and picky. He pushes back and grades strictly.' },
  { id: 'extreme', label: 'Extreme', name: 'Brutal Bernie', blurb: 'Looks for any excuse to hang up and grades harshly.' },
];
export const typeLabel = (id) => SALES_TYPES.find((t) => t.id === id)?.label || 'Sales call';
export const modeInfo = (id) => MODES.find((m) => m.id === id);
