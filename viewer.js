const els = {
  mapSelect: document.querySelector("#mapSelect"),
  overlayToggle: document.querySelector("#overlayToggle"),
  opacitySlider: document.querySelector("#opacitySlider"),
  opacityValue: document.querySelector("#opacityValue"),
  loadStatus: document.querySelector("#loadStatus"),
  mapSummary: document.querySelector("#mapSummary"),
  activeLabels: document.querySelector("#activeLabels"),
  legend: document.querySelector("#legend"),
  gridValue: document.querySelector("#gridValue"),
  voxelValue: document.querySelector("#voxelValue"),
  nonzeroValue: document.querySelector("#nonzeroValue"),
  xSlider: document.querySelector("#xSlider"),
  ySlider: document.querySelector("#ySlider"),
  zSlider: document.querySelector("#zSlider"),
  xLabel: document.querySelector("#xLabel"),
  yLabel: document.querySelector("#yLabel"),
  zLabel: document.querySelector("#zLabel"),
  sagittalCanvas: document.querySelector("#sagittalCanvas"),
  coronalCanvas: document.querySelector("#coronalCanvas"),
  axialCanvas: document.querySelector("#axialCanvas"),
};

const state = {
  manifest: null,
  template: null,
  overlay: null,
  selectedMap: null,
  templateWindow: { min: 0, max: 1 },
};

const datatypeReaders = {
  2: (view, offset) => view.getUint8(offset),
  4: (view, offset, littleEndian) => view.getInt16(offset, littleEndian),
  8: (view, offset, littleEndian) => view.getInt32(offset, littleEndian),
  16: (view, offset, littleEndian) => view.getFloat32(offset, littleEndian),
  64: (view, offset, littleEndian) => view.getFloat64(offset, littleEndian),
};

const datatypeBytes = {
  2: 1,
  4: 2,
  8: 4,
  16: 4,
  64: 8,
};

function setStatus(text, className = "") {
  els.loadStatus.textContent = text;
  els.loadStatus.className = `status-pill ${className}`.trim();
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}: ${response.status}`);
  }
  const compressed = await response.arrayBuffer();
  if (!url.endsWith(".gz")) {
    return compressed;
  }
  if (!("DecompressionStream" in window)) {
    throw new Error("This browser cannot decompress .nii.gz files.");
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

function parseNifti(buffer) {
  const view = new DataView(buffer);
  const littleEndian = view.getInt32(0, true) === 348;
  const bigEndian = view.getInt32(0, false) === 348;
  if (!littleEndian && !bigEndian) {
    throw new Error("Not a NIfTI-1 file.");
  }

  const dims = [view.getInt16(42, littleEndian), view.getInt16(44, littleEndian), view.getInt16(46, littleEndian)];
  const pixdim = [
    view.getFloat32(80, littleEndian),
    view.getFloat32(84, littleEndian),
    view.getFloat32(88, littleEndian),
  ];
  const datatype = view.getInt16(70, littleEndian);
  const bitpix = view.getInt16(72, littleEndian);
  const voxOffset = Math.floor(view.getFloat32(108, littleEndian));
  const reader = datatypeReaders[datatype];
  const bytes = datatypeBytes[datatype];

  if (!reader || !bytes) {
    throw new Error(`Unsupported NIfTI datatype ${datatype}.`);
  }

  const count = dims[0] * dims[1] * dims[2];
  const data = new Float32Array(count);
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < count; i += 1) {
    const value = reader(view, voxOffset + i * bytes, littleEndian);
    data[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return { dims, pixdim, datatype, bitpix, data, min, max };
}

async function loadNifti(url) {
  return parseNifti(await fetchArrayBuffer(url));
}

function indexFor(volume, x, y, z) {
  const [dx, dy] = volume.dims;
  return x + y * dx + z * dx * dy;
}

function percentile(values, p) {
  const sample = [];
  const stride = Math.max(1, Math.floor(values.length / 150000));
  for (let i = 0; i < values.length; i += stride) {
    if (values[i] > 0) sample.push(values[i]);
  }
  sample.sort((a, b) => a - b);
  if (!sample.length) return 0;
  return sample[Math.max(0, Math.min(sample.length - 1, Math.floor((sample.length - 1) * p)))];
}

function colorFromHex(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function labelMap() {
  return new Map(state.manifest.labels.map((label) => [label.code, label]));
}

function templateGray(value) {
  const { min, max } = state.templateWindow;
  const scaled = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  return Math.round(scaled * 255);
}

function blend(base, overlay, alpha) {
  return Math.round(base * (1 - alpha) + overlay * alpha);
}

function drawPlane(canvas, plane) {
  if (!state.template) return;

  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  const overlayVisible = els.overlayToggle.checked && state.overlay;
  const overlayAlpha = Number(els.opacitySlider.value) / 100;
  const labels = labelMap();
  const [dx, dy, dz] = state.template.dims;

  let width;
  let height;
  let voxelAt;

  if (plane === "sagittal") {
    width = dy;
    height = dz;
    const x = Number(els.xSlider.value);
    voxelAt = (u, v) => [x, dy - 1 - u, dz - 1 - v];
  } else if (plane === "coronal") {
    width = dx;
    height = dz;
    const y = Number(els.ySlider.value);
    voxelAt = (u, v) => [u, y, dz - 1 - v];
  } else {
    width = dx;
    height = dy;
    const z = Number(els.zSlider.value);
    voxelAt = (u, v) => [u, dy - 1 - v, z];
  }

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const image = ctx.createImageData(width, height);
  for (let v = 0; v < height; v += 1) {
    for (let u = 0; u < width; u += 1) {
      const [x, y, z] = voxelAt(u, v);
      const i = indexFor(state.template, x, y, z);
      let r = templateGray(state.template.data[i]);
      let g = r;
      let b = r;

      if (overlayVisible) {
        const rawLabel = Math.round(state.overlay.data[i]);
        const label = labels.get(rawLabel);
        if (rawLabel > 0 && label) {
          const [lr, lg, lb] = colorFromHex(label.color);
          r = blend(r, lr, overlayAlpha);
          g = blend(g, lg, overlayAlpha);
          b = blend(b, lb, overlayAlpha);
        }
      }

      const pixel = (v * width + u) * 4;
      image.data[pixel] = r;
      image.data[pixel + 1] = g;
      image.data[pixel + 2] = b;
      image.data[pixel + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function updateSliceLabels() {
  els.xLabel.textContent = `x ${els.xSlider.value}`;
  els.yLabel.textContent = `y ${els.ySlider.value}`;
  els.zLabel.textContent = `z ${els.zSlider.value}`;
}

function renderAll() {
  updateSliceLabels();
  drawPlane(els.sagittalCanvas, "sagittal");
  drawPlane(els.coronalCanvas, "coronal");
  drawPlane(els.axialCanvas, "axial");
}

function renderLegend() {
  els.legend.replaceChildren(
    ...state.manifest.labels
      .filter((label) => label.code > 0)
      .map((label) => legendItem(label, true))
  );
}

function legendItem(label, showCode) {
  const row = document.createElement("div");
  row.className = "legend-item";

  const swatch = document.createElement("span");
  swatch.className = "swatch";
  swatch.style.background = label.color;

  const text = document.createElement("span");
  text.className = "legend-text";
  const title = document.createElement("strong");
  title.textContent = label.name;
  const subtitle = document.createElement("span");
  subtitle.textContent = `${label.model}, ${label.sign}`;
  text.append(title, subtitle);

  const code = document.createElement("span");
  code.className = "code";
  code.textContent = showCode ? label.code : "";

  row.append(swatch, text, code);
  return row;
}

function renderMapDetails() {
  const map = state.selectedMap;
  const labels = labelMap();
  const active = map.uniqueLabels.filter((code) => code > 0).map((code) => labels.get(code)).filter(Boolean);

  if (active.length) {
    els.activeLabels.replaceChildren(...active.map((label) => legendItem(label, true)));
    setStatus("Ready", "ready");
  } else {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No significant voxels in this map.";
    els.activeLabels.replaceChildren(empty);
    setStatus("No overlay", "warning");
  }

  els.gridValue.textContent = map.dimensions.join(" x ");
  els.voxelValue.textContent = `${map.pixdim.join(" x ")} mm`;
  els.nonzeroValue.textContent = map.nonzeroVoxels.toLocaleString();
  els.mapSummary.textContent = `${map.name}: labels ${map.uniqueLabels.join(", ")}`;
}

function focusOverlayCenter() {
  if (!state.overlay || state.selectedMap.nonzeroVoxels === 0) return;

  const [dx, dy, dz] = state.overlay.dims;
  let minX = dx;
  let minY = dy;
  let minZ = dz;
  let maxX = 0;
  let maxY = 0;
  let maxZ = 0;

  for (let z = 0; z < dz; z += 1) {
    for (let y = 0; y < dy; y += 1) {
      for (let x = 0; x < dx; x += 1) {
        if (Math.round(state.overlay.data[indexFor(state.overlay, x, y, z)]) > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (z < minZ) minZ = z;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (z > maxZ) maxZ = z;
        }
      }
    }
  }

  els.xSlider.value = Math.round((minX + maxX) / 2);
  els.ySlider.value = Math.round((minY + maxY) / 2);
  els.zSlider.value = Math.round((minZ + maxZ) / 2);
}

async function selectMap(id) {
  state.selectedMap = state.manifest.maps.find((map) => map.id === id);
  setStatus("Loading");
  state.overlay = await loadNifti(state.selectedMap.url);
  focusOverlayCenter();
  renderMapDetails();
  renderAll();
}

function configureControls() {
  const [dx, dy, dz] = state.template.dims;
  els.xSlider.max = dx - 1;
  els.ySlider.max = dy - 1;
  els.zSlider.max = dz - 1;
  els.xSlider.value = Math.floor(dx / 2);
  els.ySlider.value = Math.floor(dy / 2);
  els.zSlider.value = Math.floor(dz / 2);

  els.mapSelect.replaceChildren(
    ...state.manifest.maps.map((map) => {
      const option = document.createElement("option");
      option.value = map.id;
      option.textContent = map.name;
      return option;
    })
  );

  els.mapSelect.addEventListener("change", () => selectMap(els.mapSelect.value));
  els.overlayToggle.addEventListener("change", renderAll);
  els.opacitySlider.addEventListener("input", () => {
    els.opacityValue.textContent = `${els.opacitySlider.value}%`;
    renderAll();
  });

  [els.xSlider, els.ySlider, els.zSlider].forEach((slider) => {
    slider.addEventListener("input", renderAll);
  });
}

async function init() {
  try {
    const response = await fetch("assets/manifest.json");
    state.manifest = await response.json();
    setStatus("Template");
    state.template = await loadNifti(state.manifest.template.url);
    state.templateWindow = {
      min: percentile(state.template.data, 0.02),
      max: percentile(state.template.data, 0.98),
    };
    configureControls();
    renderLegend();
    await selectMap(state.manifest.maps[0].id);
  } catch (error) {
    console.error(error);
    setStatus("Error", "warning");
    els.mapSummary.textContent = error.message;
  }
}

init();
