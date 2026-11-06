import { useEffect, useRef, useState } from 'react';
import { BoxIcon, RotateCcwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { ErrorMessage } from '@/components/ErrorMessage';
import { PreviewLoading, PreviewProblem } from './PreviewStatus';
import type { PreviewSource } from './preview-source';
import { useDisplayUrl } from './use-display-url';

interface Stats {
  triangles: number;
  vertices: number;
  meshes: number;
}

interface Viewer {
  setWireframe(on: boolean): void;
  resetView(): void;
  dispose(): void;
}

/** Sets up three.js: lights, orbit controls, the model centred in view. */
async function createViewer(
  container: HTMLDivElement,
  blob: Blob,
  ext: string,
): Promise<{ viewer: Viewer; stats: Stats }> {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const { loadModel, modelStats } = await import('@/engines/three-models');

  const model = await loadModel(await blob.arrayBuffer(), ext);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(3, 5, 4);
  scene.add(sun);

  // Centre the model and look at it from a pleasant angle.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  model.position.sub(box.getCenter(new THREE.Vector3()));
  scene.add(model);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    size / 100,
    size * 100,
  );
  // Far enough that the whole model fits in the 45° view, with some margin.
  const distance = (size / 2 / Math.sin((22.5 * Math.PI) / 180)) * 1.2;
  const home = new THREE.Vector3(0.6, 0.45, 0.8).normalize().multiplyScalar(distance);
  camera.position.copy(home);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  let frame = 0;
  const render = () => {
    frame = requestAnimationFrame(render);
    controls.update();
    renderer.render(scene, camera);
  };
  render();

  const resize = new ResizeObserver(() => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
  resize.observe(container);

  const materials = new Set<{ wireframe: boolean; needsUpdate: boolean }>();
  model.traverse((child) => {
    const material = (child as { material?: unknown }).material;
    for (const m of Array.isArray(material) ? material : [material]) {
      if (m && typeof m === 'object' && 'wireframe' in m)
        materials.add(m as { wireframe: boolean; needsUpdate: boolean });
    }
  });

  return {
    stats: modelStats(model),
    viewer: {
      setWireframe(on) {
        for (const m of materials) {
          m.wireframe = on;
          m.needsUpdate = true;
        }
      },
      resetView() {
        camera.position.copy(home);
        controls.target.set(0, 0, 0);
        controls.update();
      },
      dispose() {
        cancelAnimationFrame(frame);
        resize.disconnect();
        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      },
    },
  };
}

function webglAvailable(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/** 3D model: rotate with the mouse or finger, zoom with the wheel or pinch. */
export function ModelPreview({ source }: { source: PreviewSource }) {
  const { t, i18n } = useTranslation();
  const display = useDisplayUrl(source, 'model');
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blob = display.status === 'ready' ? display.blob : null;
  const ext = display.status === 'ready' ? display.ext : null;

  useEffect(() => {
    const target = container.current;
    if (!blob || !ext || !target) return;
    let cancelled = false;
    createViewer(target, blob, ext)
      .then((created) => {
        if (cancelled) {
          created.viewer.dispose();
          return;
        }
        viewer.current = created.viewer;
        setStats(created.stats);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, [blob, ext]);

  if (!webglAvailable()) return <ErrorMessage messageKey="errors.noWebgl" />;
  if (display.status === 'loading') return <PreviewLoading state={display} />;
  if (display.status === 'error') return <PreviewProblem state={display} />;
  if (error) return <ErrorMessage messageKey="errors.previewUnavailable" details={error} />;

  const number = (n: number) => n.toLocaleString(i18n.language);
  return (
    <div className="space-y-2" data-testid="model-preview">
      <div
        ref={container}
        className="h-[60vh] touch-none overflow-hidden rounded-md border bg-[radial-gradient(circle,var(--muted),transparent)]"
        aria-label={t('preview.model3d')}
        role="img"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" data-testid="model-stats">
          {stats
            ? t('preview.modelStats', {
                triangles: number(stats.triangles),
                vertices: number(stats.vertices),
                count: stats.meshes,
              })
            : t('preview.loading')}
        </p>
        <div className="flex gap-1">
          <Toggle
            variant="outline"
            size="sm"
            pressed={wireframe}
            onPressedChange={(on) => {
              setWireframe(on);
              viewer.current?.setWireframe(on);
            }}
          >
            <BoxIcon aria-hidden="true" />
            {t('preview.wireframe')}
          </Toggle>
          <Button size="sm" variant="outline" onClick={() => viewer.current?.resetView()}>
            <RotateCcwIcon aria-hidden="true" />
            {t('preview.resetView')}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('preview.modelHint')}</p>
    </div>
  );
}
