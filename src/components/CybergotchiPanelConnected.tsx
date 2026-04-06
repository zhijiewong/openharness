import React from 'react';
import { useCybergotchi } from '../cybergotchi/useCybergotchi.js';
import CompanionFooter from './CompanionFooter.js';

/**
 * Self-contained wrapper that owns the useCybergotchi hook.
 * Isolates all 500ms animation re-renders to this subtree only,
 * preventing the parent REPL from re-rendering on every tick.
 */
export default function CybergotchiPanelConnected() {
  const { config, bones, state } = useCybergotchi();
  if (!config || !bones) return null;
  return <CompanionFooter bones={bones} config={config} state={state} />;
}
