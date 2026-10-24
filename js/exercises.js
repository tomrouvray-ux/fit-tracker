// Exercise library: free-exercise-db (public domain) plus the user's own exercises.

import { state } from './store.js';

const IMG_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

let lib = [];
let byId = new Map();
let loading = null;

export function loadLibrary() {
  if (!loading) {
    loading = fetch('data/exercises.json')
      .then(r => r.json())
      .then(list => {
        lib = list;
        byId = new Map(list.map(x => [x.id, x]));
      })
      .catch(() => {});
  }
  return loading;
}

export function allExercises() {
  return [...state.customExercises, ...lib];
}

export function getExercise(id) {
  return byId.get(id) || state.customExercises.find(x => x.id === id) || null;
}

export function imageUrl(ex, i = 0) {
  if (!ex || ex.custom || !ex.img) return null;
  return IMG_BASE + encodeURI(ex.id) + '/' + i + '.jpg';
}

export const MUSCLES = ['chest', 'shoulders', 'triceps', 'biceps', 'forearms', 'lats', 'middle back', 'lower back', 'traps', 'abdominals', 'quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors', 'neck'];
export const EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'machine', 'body only', 'kettlebells', 'bands', 'e-z curl bar', 'medicine ball', 'exercise ball', 'foam roll', 'other'];

export function search(q, { muscle = '', equipment = '', limit = 60 } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const x of allExercises()) {
    if (muscle && !(x.m || []).includes(muscle)) continue;
    if (equipment && x.e !== equipment) continue;
    const n = x.n.toLowerCase();
    if (words.every(w => n.includes(w))) out.push(x);
    if (out.length >= limit) break;
  }
  return out;
}

// Timed or distance-based exercises log time instead of weight x reps.
export function isTimed(ex) {
  return !!ex && (ex.c === 'cardio' || ex.c === 'stretching' || /plank|hold|hang/i.test(ex.n));
}

// Starter plans (ids from free-exercise-db). Loaded as ordinary, editable routines.
const E = (id, sets = 3, reps = '8-12', rest = 90) => ({ exId: id, sets, reps, rest });
export const STARTERS = [
  {
    name: 'Push / Pull / Legs',
    routines: [
      { name: 'Push', days: [1, 4], exercises: [E('Barbell_Bench_Press_-_Medium_Grip', 4, '6-8', 150), E('Standing_Military_Press', 3, '6-10', 120), E('Incline_Dumbbell_Press'), E('Side_Lateral_Raise', 3, '12-15', 60), E('Triceps_Pushdown', 3, '10-12', 60)] },
      { name: 'Pull', days: [2, 5], exercises: [E('Barbell_Deadlift', 3, '5', 180), E('Pullups', 3, '6-10', 120), E('Bent_Over_Barbell_Row', 3, '8-10', 120), E('Face_Pull', 3, '12-15', 60), E('Barbell_Curl', 3, '10-12', 60)] },
      { name: 'Legs', days: [3, 6], exercises: [E('Barbell_Squat', 4, '6-8', 180), E('Romanian_Deadlift', 3, '8-10', 120), E('Leg_Press', 3, '10-12', 120), E('Lying_Leg_Curls', 3, '10-12', 60), E('Standing_Calf_Raises', 4, '10-15', 60)] },
    ],
  },
  {
    name: 'Upper / Lower',
    routines: [
      { name: 'Upper', days: [1, 4], exercises: [E('Barbell_Bench_Press_-_Medium_Grip', 4, '6-8', 150), E('Bent_Over_Barbell_Row', 4, '6-8', 120), E('Dumbbell_Shoulder_Press'), E('Wide-Grip_Lat_Pulldown'), E('Hammer_Curls', 2, '10-12', 60), E('Triceps_Pushdown', 2, '10-12', 60)] },
      { name: 'Lower', days: [2, 5], exercises: [E('Barbell_Squat', 4, '6-8', 180), E('Romanian_Deadlift', 3, '8-10', 120), E('Dumbbell_Lunges', 3, '10', 90), E('Leg_Extensions', 3, '12', 60), E('Standing_Calf_Raises', 3, '12-15', 60), E('Plank', 3, '45s', 60)] },
    ],
  },
  {
    name: 'Full Body 3x',
    routines: [
      { name: 'Full Body A', days: [1, 5], exercises: [E('Barbell_Squat', 3, '5', 180), E('Barbell_Bench_Press_-_Medium_Grip', 3, '5', 150), E('Bent_Over_Barbell_Row', 3, '8', 120), E('Plank', 3, '45s', 60)] },
      { name: 'Full Body B', days: [3], exercises: [E('Barbell_Deadlift', 3, '5', 180), E('Standing_Military_Press', 3, '6-8', 120), E('Pullups', 3, '6-10', 120), E('Dumbbell_Lunges', 3, '10', 90)] },
    ],
  },
];

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
