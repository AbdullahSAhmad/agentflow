import { createApp } from './app.js';
import { WsClient } from './connection/ws-client.js';
import { StateStore } from './connection/state-store.js';
import { WorldManager } from './world/world-manager.js';
import { AgentManager } from './agents/agent-manager.js';
import { Overlay } from './ui/overlay.js';
import { AgentDetailPanel } from './ui/agent-detail-panel.js';
import { Timeline } from './ui/timeline.js';
import { SoundManager } from './audio/sound-manager.js';
import { NotificationManager } from './audio/notification-manager.js';

async function main() {
  const appEl = document.getElementById('app')!;

  // Init Pixi application
  const pixiApp = await createApp(appEl);

  // Init state store
  const store = new StateStore();

  // Init world (zones, grid, camera)
  const world = new WorldManager(pixiApp);

  // Init agent manager (bridges state -> rendering)
  const agentManager = new AgentManager(pixiApp, world, store);

  // Init audio
  const sound = new SoundManager();
  const notifications = new NotificationManager();
  agentManager.setSoundManager(sound);
  agentManager.setNotificationManager(notifications);

  // Init overlay (HTML sidebar)
  const overlay = new Overlay(store);

  // Init detail panel
  const detailPanel = new AgentDetailPanel(store);
  overlay.setAgentClickHandler((agentId) => detailPanel.open(agentId));

  // Init timeline
  const timeline = new Timeline(store);
  timeline.setReplayCallback((agents) => {
    agentManager.rebuildFromState(agents);
  });

  // Connect WebSocket
  const ws = new WsClient(store);
  ws.connect();

  // Zoom controls
  document.getElementById('zoom-in')!.addEventListener('click', () => world.camera.zoomIn());
  document.getElementById('zoom-out')!.addEventListener('click', () => world.camera.zoomOut());
  document.getElementById('zoom-reset')!.addEventListener('click', () => world.resetCamera());

  // Audio controls
  const muteBtn = document.getElementById('mute-btn')!;
  const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement;
  const volumeLabel = document.getElementById('volume-label')!;

  muteBtn.addEventListener('click', () => {
    sound.init(); // Unlock AudioContext on first user gesture
    sound.muted = !sound.muted;
    muteBtn.textContent = sound.muted ? '\u{1F507}' : '\u{1F508}';
    muteBtn.classList.toggle('muted', sound.muted);
  });

  volumeSlider.addEventListener('input', () => {
    sound.init(); // Unlock AudioContext on first user gesture
    const val = parseInt(volumeSlider.value, 10);
    sound.volume = val / 100;
    volumeLabel.textContent = `${val}%`;
  });

  // Request notification permission on first interaction
  document.addEventListener('click', () => {
    sound.init();
    notifications.requestPermission();
  }, { once: true });

  // Game loop
  pixiApp.ticker.add(() => {
    agentManager.update(pixiApp.ticker.deltaMS);
  });

  console.log('Claude Code Visualizer started');
}

main().catch(console.error);
