import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import { ArrowLeft, Upload, Download, RotateCcw, Image as ImageIcon, Loader2, Sparkles, ChevronDown } from "lucide-react";

// ─── Depth map generation ──────────────────────────────────────────────
function generateDepthMap(
  image: HTMLImageElement | HTMLCanvasElement,
  width: number,
  height: number,
): Float32Array {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const depth = new Float32Array(width * height);

  // Luminance-based depth
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    depth[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  // Edge enhancement via simple Laplacian-like neighbor contrast
  const edgeStrength = new Float32Array(width * height);
  const padded = depth.slice(); // copy
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      // Simple gradient magnitude
      const dx = padded[(y) * width + (x + 1)] - padded[(y) * width + (x - 1)];
      const dy = padded[(y + 1) * width + (x)] - padded[(y - 1) * width + (x)];
      edgeStrength[i] = Math.sqrt(dx * dx + dy * dy);
    }
  }

  // Blend: 70% luminance + 30% edge enhancement
  const result = new Float32Array(width * height);
  let minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < width * height; i++) {
    result[i] = depth[i] * 0.7 + edgeStrength[i] * 80 * 0.3;
    if (result[i] < minV) minV = result[i];
    if (result[i] > maxV) maxV = result[i];
  }
  const range = maxV - minV;
  if (range > 0) {
    for (let i = 0; i < width * height; i++) {
      result[i] = (result[i] - minV) / range;
    }
  }

  return result;
}

// ─── 3D Scene Components ──────────────────────────────────────────────

function SceneLights() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1.4} />
      <directionalLight position={[-3, 4, -3]} intensity={0.4} />
      <hemisphereLight args={["#f0f0ff", "#202030", 0.4]} />
    </>
  );
}

function DisplacedMesh({
  texture,
  depthMap,
  depthWidth,
  depthHeight,
  gridSize,
  strength,
}: {
  texture: THREE.Texture | null;
  depthMap: Float32Array | null;
  depthWidth: number;
  depthHeight: number;
  gridSize: number;
  strength: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => {
    return new THREE.PlaneGeometry(2, 2, gridSize, gridSize);
  }, [gridSize]);

  useEffect(() => {
    if (!depthMap || !meshRef.current) return;
    const pos = geometry.attributes.position.array as Float32Array;
    const w = gridSize + 1;
    const h = gridSize + 1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 3;
        const u = x / gridSize;
        const v = y / gridSize;
        const di = Math.min(Math.floor(u * depthWidth), depthWidth - 1);
        const dj = Math.min(Math.floor(v * depthHeight), depthHeight - 1);
        const depthVal = depthMap[dj * depthWidth + di];
        pos[idx + 2] = (depthVal - 0.5) * strength;
      }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
  }, [depthMap, depthWidth, depthHeight, gridSize, strength, geometry]);

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial
        map={texture}
        side={THREE.DoubleSide}
        roughness={0.35}
        metalness={0.05}
      />
    </mesh>
  );
}

function PlaceholderModel() {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.x += delta * 0.3;
      meshRef.current.rotation.y += delta * 0.5;
    }
  });
  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <torusKnotGeometry args={[0.6, 0.25, 128, 32]} />
      <meshStandardMaterial
        color="#6EB5FF"
        roughness={0.3}
        metalness={0.7}
        wireframe={false}
      />
    </mesh>
  );
}

function Scene({
  texture,
  depthMap,
  depthWidth,
  depthHeight,
  strength,
  hasImage,
}: {
  texture: THREE.Texture | null;
  depthMap: Float32Array | null;
  depthWidth: number;
  depthHeight: number;
  strength: number;
  hasImage: boolean;
}) {
  return (
    <>
      <SceneLights />
      <OrbitControls
        enablePan
        enableZoom
        minDistance={0.8}
        maxDistance={6}
        autoRotate={!hasImage}
        autoRotateSpeed={2}
      />
      {hasImage && texture && depthMap ? (
        <DisplacedMesh
          texture={texture}
          depthMap={depthMap}
          depthWidth={depthWidth}
          depthHeight={depthHeight}
          gridSize={128}
          strength={strength}
        />
      ) : !hasImage ? (
        <PlaceholderModel />
      ) : null}
      <Grid
        position={[0, -1.6, 0]}
        args={[8, 8]}
        cellColor="#444"
        sectionColor="#666"
        fadeDistance={10}
        cellSize={0.5}
        sectionSize={1}
      />
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────

export default function ThreeDEditor() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [depthMap, setDepthMap] = useState<Float32Array | null>(null);
  const [depthRes, setDepthRes] = useState({ w: 0, h: 0 });
  const [strength, setStrength] = useState(0.6);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    setIsProcessing(true);

    // Dispose previous texture to avoid GPU memory leak
    setTexture((prev) => {
      if (prev) prev.dispose();
      return null;
    });

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Create texture
        const tex = new THREE.Texture(img);
        tex.needsUpdate = true;
        setTexture(tex);
        setImage(img);

        // Generate depth map
        const res = 128;
        const dm = generateDepthMap(img, res, res);
        setDepthMap(dm);
        setDepthRes({ w: res, h: res });
        setIsProcessing(false);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleImageFile(file);
    },
    [handleImageFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleReset = useCallback(() => {
    setTexture((prev) => {
      if (prev) prev.dispose();
      return null;
    });
    setImage(null);
    setDepthMap(null);
    setStrength(0.6);
  }, []);

  const handleExport = useCallback(() => {
    if (!texture || !depthMap) return;
    const res = 128;

    // Build export geometry at higher quality
    const exportGeo = new THREE.PlaneGeometry(2, 2, 128, 128);
    const pos = exportGeo.attributes.position.array as Float32Array;
    const w = 129;
    const h = 129;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 3;
        const u = x / 128;
        const v = y / 128;
        const di = Math.min(Math.floor(u * res), res - 1);
        const dj = Math.min(Math.floor(v * res), res - 1);
        const depthVal = depthMap[dj * res + di];
        pos[idx + 2] = (depthVal - 0.5) * strength;
      }
    }
    exportGeo.attributes.position.needsUpdate = true;
    exportGeo.computeVertexNormals();

    const exportMesh = new THREE.Mesh(exportGeo, new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide }));
    const exportScene = new THREE.Scene();
    exportScene.add(exportMesh);

    // Center and scale
    const box = new THREE.Box3().setFromObject(exportMesh);
    const center = box.getCenter(new THREE.Vector3());
    exportMesh.position.sub(center);

    // Use GLTF export from Three.js examples
    import("three/examples/jsm/exporters/GLTFExporter.js").then(({ GLTFExporter }) => {
      const exporter = new GLTFExporter();
      exporter.parse(
        exportScene,
        (gltf: ArrayBuffer | { [key: string]: unknown }) => {
          const blob = new Blob(
            [gltf as ArrayBuffer],
            { type: "application/octet-stream" },
          );
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "toonhub-3d-model.glb";
          a.click();
          URL.revokeObjectURL(url);
        },
        (error: unknown) => console.error("Export error:", error),
        { binary: true, trs: false, onlyVisible: true },
      );
    });
  }, [texture, depthMap, strength]);

  const hasImage = image !== null;

  return (
    <div className="h-screen w-full bg-black flex overflow-hidden">
      {/* Left Panel */}
      <div className="w-[340px] shrink-0 h-full bg-zinc-950 border-r border-zinc-800 flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
            >
              <ArrowLeft size={18} />
            </a>
            <div>
              <h1 className="text-white font-bold text-base tracking-tight">
                3D Studio
              </h1>
              <p className="text-zinc-500 text-[11px] mt-0.5">
                Turn 2D images into 3D models
              </p>
            </div>
          </div>
        </div>

        {/* Upload area */}
        <div className="p-4">
          {!hasImage ? (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
                isDragging
                  ? "border-blue-400 bg-blue-500/10 scale-[1.02]"
                  : "border-zinc-700 hover:border-zinc-500 bg-zinc-900/50 hover:bg-zinc-900/80"
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center mx-auto mb-4">
                <Upload className="text-zinc-400" size={22} />
              </div>
              <p className="text-zinc-200 text-sm font-medium mb-1">
                Upload an image
              </p>
              <p className="text-zinc-500 text-xs">
                Drag & drop or click to browse
              </p>
              <p className="text-zinc-600 text-[10px] mt-3">
                Supports JPG, PNG, WebP
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Image preview */}
              <div className="relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
                <img
                  src={image.src}
                  alt="Uploaded"
                  className="w-full h-36 object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                <div className="absolute bottom-2 left-3 text-white/80 text-[11px] font-medium flex items-center gap-1.5">
                  <ImageIcon size={12} />
                  Source Image
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-zinc-700 text-zinc-300 text-xs font-medium hover:bg-zinc-800 transition-all"
                >
                  <RotateCcw size={14} />
                  New
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-zinc-700 text-zinc-300 text-xs font-medium hover:bg-zinc-800 transition-all"
                >
                  <Upload size={14} />
                  Replace
                </button>
                <button
                  onClick={handleExport}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-500 transition-all"
                >
                  <Download size={14} />
                  Export
                </button>
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {/* Controls */}
        {hasImage && (
          <div className="flex-1 px-4 pb-4 overflow-y-auto">
            <div className="border-t border-zinc-800 pt-4 mb-4">
              <button
                onClick={() => setShowControls(!showControls)}
                className="flex items-center justify-between w-full text-zinc-300 text-xs font-semibold uppercase tracking-wider"
              >
                <span className="flex items-center gap-2">
                  <Sparkles size={14} className="text-blue-400" />
                  Depth Settings
                </span>
                <ChevronDown
                  size={14}
                  className={`text-zinc-500 transition-transform ${showControls ? "rotate-0" : "-rotate-90"}`}
                />
              </button>
            </div>

            {showControls && (
              <div className="space-y-5">
                {/* Strength */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-zinc-400 text-xs">Displacement</label>
                    <span className="text-zinc-500 text-[11px] font-mono">
                      {Math.round(strength * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="1.5"
                    step="0.01"
                    value={strength}
                    onChange={(e) => setStrength(parseFloat(e.target.value))}
                    className="w-full h-1.5 appearance-none bg-zinc-800 rounded-full cursor-pointer
                      [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                      [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500
                      [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-blue-500/30
                      [&::-webkit-slider-thumb]:cursor-pointer
                      [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4
                      [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-500
                      [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
                  />
                </div>

                {/* Info */}
                <div className="rounded-xl bg-zinc-900/70 border border-zinc-800 p-3">
                  <p className="text-zinc-400 text-[11px] leading-relaxed">
                    Lighter areas of your image are raised higher in the 3D
                    model. Adjust displacement to control depth intensity.
                  </p>
                </div>

                {/* Tips */}
                <div className="rounded-xl bg-zinc-900/70 border border-zinc-800 p-3">
                  <p className="text-zinc-500 text-[10px] font-semibold uppercase tracking-wider mb-2">
                    Tips
                  </p>
                  <ul className="text-zinc-400 text-[11px] space-y-1.5 leading-relaxed">
                    <li>• High contrast images work best</li>
                    <li>• Use orbit controls to inspect from any angle</li>
                    <li>• Export as GLB for use in other apps</li>
                  </ul>
                </div>

                {/* Processing indicator */}
                {isProcessing && (
                  <div className="flex items-center gap-2 text-zinc-400 text-xs">
                    <Loader2 size={14} className="animate-spin text-blue-400" />
                    Generating 3D model...
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bottom branding */}
        {!hasImage && (
          <div className="mt-auto p-4 border-t border-zinc-800">
            <p className="text-zinc-600 text-[10px] text-center">
              Free browser-based 3D conversion · No uploads to servers
            </p>
          </div>
        )}
      </div>

      {/* 3D Viewport */}
      <div className="flex-1 relative bg-gradient-to-b from-zinc-900 via-black to-zinc-950">
        {/* Status overlay when no image */}
        {!hasImage && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="text-center max-w-xs">
              <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4">
                <ImageIcon size={28} className="text-white/30" />
              </div>
              <p className="text-white/40 text-xs">
                Upload an image to begin<br />converting 2D to 3D
              </p>
            </div>
          </div>
        )}

        <Canvas
          camera={{ position: [0, 0.2, 2.8], fov: 40 }}
          gl={{ antialias: true, alpha: false }}
          dpr={[1, 2]}
          className="w-full h-full"
        >
          <Scene
            texture={texture}
            depthMap={depthMap}
            depthWidth={depthRes.w}
            depthHeight={depthRes.h}
            strength={strength}
            hasImage={hasImage}
          />
        </Canvas>

        {/* Viewport instructions */}
        {hasImage && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none">
            <p className="text-zinc-600 text-[10px] text-center">
              Drag to orbit · Scroll to zoom · Right-click to pan
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
