// ============================================================================
// 3D pouch label viewer  (markup: [data-pouch-viewer] in index.html,
// styles: "3D pouch label viewer" block in assets/css/custom.css)
//
// A stand-up pouch built in code (no model file, no 3D library — plain
// WebGL), wrapped with a label image. The visitor can:
//   - drag it to rotate (mouse or finger),
//   - use the left / right arrows to switch to the next label design.
//
// LABEL ART lives in assets/labels/ and is listed in assets/labels/labels.json.
// Each label is ONE image, 2048 x 1536 px: the LEFT half is the front of the
// pouch, the RIGHT half is the back. To add or replace a design, drop the
// image in that folder and add/edit its line in labels.json — nothing in
// this file needs to change. See assets/labels/README.txt.
//
// BOTTOM OF THE POUCH: a label can also name a "bottom" image in labels.json
// (a pattern or texture). It is laid flat across the base of the pouch.
// Labels without one get a plain base in the colour of the label's bottom edge.
// ============================================================================

(function () {
	"use strict";

	var viewer = document.querySelector("[data-pouch-viewer]");
	if (!viewer) return;

	var canvas = viewer.querySelector("[data-pouch-canvas]");
	var prevBtn = viewer.querySelector("[data-pouch-prev]");
	var nextBtn = viewer.querySelector("[data-pouch-next]");
	var nameEl = viewer.querySelector("[data-pouch-name]");
	var countEl = viewer.querySelector("[data-pouch-count]");
	if (!canvas) return;

	// ------------------------------------------------------------------
	// Settings — safe to tweak.
	// ------------------------------------------------------------------
	var LABELS_URL = viewer.getAttribute("data-labels") || "assets/labels/labels.json";

	var POUCH = {
		width: 1.0,        // pouch face is 2:3 (same proportions as one half of a label image)
		height: 1.5,
		depth: 0.17,       // how far each face bulges out at its fullest point
		topSeal: 0.10,     // flat heat-sealed strip at the top (fraction of the height)
		sideSeal: 0.03     // flat sealed strip down each side (fraction of the width)
	};

	var DRAG_SPEED = 0.009;      // radians of rotation per pixel dragged
	var MAX_TILT = 0.55;         // how far it can tip forward / back (radians)
	var SWAY_ANGLE = 0.38;       // gentle idle sway, so it reads as 3D before anyone touches it
	var SWAY_SPEED = 0.7;
	var IDLE_BEFORE_SWAY = 2500; // ms after the last interaction before the sway comes back
	var CHANGE_DURATION = 900;   // ms — the spin when switching labels

	var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	// ------------------------------------------------------------------
	// WebGL setup
	// ------------------------------------------------------------------
	var glOptions = { alpha: true, antialias: true, premultipliedAlpha: true };
	var gl = null;
	var isWebGL2 = false;
	try {
		gl = canvas.getContext("webgl2", glOptions);
		isWebGL2 = !!gl;
		if (!gl) gl = canvas.getContext("webgl", glOptions) || canvas.getContext("experimental-webgl", glOptions);
	} catch (e) {
		gl = null;
	}
	if (!gl) {
		// No WebGL on this device: hide the whole block rather than show an empty box.
		viewer.hidden = true;
		return;
	}

	var VERTEX_SHADER = [
		"attribute vec3 aPosition;",
		"attribute vec3 aNormal;",
		"attribute vec2 aUv;",      // where to read the label image
		"attribute vec2 aPanel;",   // position on the pouch face (0-1 across, 0-1 bottom to top); x = -1: edge strip; x <= -2: the base
		"uniform mat4 uProjView;",
		"uniform mat4 uModel;",
		"varying vec3 vNormal;",
		"varying vec3 vWorld;",
		"varying vec2 vUv;",
		"varying vec2 vPanel;",
		"void main() {",
		"	vec4 world = uModel * vec4(aPosition, 1.0);",
		"	vWorld = world.xyz;",
		"	vNormal = mat3(uModel) * aNormal;",
		"	vUv = aUv;",
		"	vPanel = aPanel;",
		"	gl_Position = uProjView * world;",
		"}"
	].join("\n");

	var FRAGMENT_SHADER = [
		"#ifdef GL_FRAGMENT_PRECISION_HIGH",
		"precision highp float;",
		"#else",
		"precision mediump float;",
		"#endif",
		"uniform sampler2D uLabel;",
		"uniform sampler2D uBottom;",      // optional image for the base of the pouch
		"uniform vec2 uBottomScale;",      // how the base maps onto that image
		"uniform float uHasBottom;",       // 1.0 when this label has a bottom image
		"uniform vec3 uCamera;",
		"uniform float uTopSeal;",
		"varying vec3 vNormal;",
		"varying vec3 vWorld;",
		"varying vec2 vUv;",
		"varying vec2 vPanel;",
		"",
		"vec3 lightIt(vec3 base, vec3 N, vec3 V, vec3 L, float strength, float gloss) {",
		"	float diffuse = max(dot(N, L), 0.0);",
		"	vec3 H = normalize(L + V);",
		"	float sharp = pow(max(dot(N, H), 0.0), 70.0) * 0.16;",   // tight highlight (the film's gloss)
		"	float soft = pow(max(dot(N, H), 0.0), 10.0) * 0.022;",    // wide sheen
		"	return (base * diffuse + vec3(sharp + soft) * gloss) * strength;",
		"}",
		"",
		"void main() {",
		"	vec3 N = normalize(vNormal);",
		"	vec3 V = normalize(uCamera - vWorld);",
		"	float sealStart = 1.0 - uTopSeal;",
		"	if (vPanel.x >= 0.0) {",
		// Crimped heat seal along the top: fine horizontal ridges.
		"		float inSeal = smoothstep(sealStart - 0.004, sealStart + 0.004, vPanel.y);",
		"		N.y += inSeal * 0.22 * sin(vPanel.y * 520.0);",
		// A thin crease where the seal ends and the pouch starts to fill out.
		"		float crease = 1.0 - smoothstep(0.0, 0.006, abs(vPanel.y - sealStart));",
		"		N.y -= crease * 0.35;",
		"		N = normalize(N);",
		"	}",
		// The base of the pouch (marked by vPanel.x <= -2) shows the label's
		// "bottom" image if it has one, laid flat across it; vPanel then holds
		// where we are on the base, side to side and front to back. Any
		// see-through parts of that image show the label's edge colour.
		"	float isBase = step(vPanel.x, -1.5);",
		"	vec2 bottomUv = vec2(0.5 + (-2.5 - vPanel.x) * uBottomScale.x, 0.5 + vPanel.y * uBottomScale.y);",
		"	vec4 bottomTexel = texture2D(uBottom, bottomUv);",
		"	vec3 labelTexel = texture2D(uLabel, vUv).rgb;",
		"	vec3 base = pow(mix(labelTexel, bottomTexel.rgb, isBase * uHasBottom * bottomTexel.a), vec3(2.2));",
		"	vec3 color = base * 0.34;",                                                     // ambient
		"	color += lightIt(base, N, V, normalize(vec3(0.45, 0.65, 1.0)), 0.78, 1.0);",    // key light, front right
		"	color += lightIt(base, N, V, normalize(vec3(-0.9, 0.15, 0.55)), 0.28, 0.5);",   // fill, left
		"	color += lightIt(base, N, V, normalize(vec3(0.0, 0.6, -1.0)), 0.45, 0.6);",     // back light
		// The lights above never reach the underside, so the base gets its own
		// soft light from below — otherwise its colour / pattern would look dull.
		"	color += lightIt(base, N, V, normalize(vec3(0.25, -1.0, 0.45)), 0.50 * isBase, 0.35);",
		// Soft edge glow so the silhouette stays readable on the black page.
		"	float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);",
		"	color += vec3(rim) * 0.05;",
		"	gl_FragColor = vec4(pow(color, vec3(1.0 / 2.2)), 1.0);",
		"}"
	].join("\n");

	// ------------------------------------------------------------------
	// The pouch model. Front and back are two curved sheets that meet at
	// the sealed sides and top, filled out towards the bottom like a real
	// stand-up pouch, plus a flat base. Returns plain arrays (positions,
	// normals, label UVs, panel coordinates, triangle indices).
	// ------------------------------------------------------------------
	function buildPouch(P) {
		var NU = 56, NV = 84;
		var pos = [], nor = [], uv = [], panel = [], idx = [];

		function clamp01(x) { return Math.max(0, Math.min(1, x)); }
		function smoothstep(a, b, x) { var t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

		// How far the face is pushed out at height v (0 = bottom, 1 = top).
		function fill(v) {
			var q = clamp01((1 - P.topSeal - v) / (1 - P.topSeal)); // 0 at the seal, 1 at the base
			var f = Math.pow(Math.sin(q * Math.PI / 2), 0.85);
			return { q: q, f: f * (1 - 0.14 * smoothstep(0.78, 1, q)) };
		}

		// Point on a face. side = +1 front, -1 back.
		function point(u, v, side) {
			var fl = fill(v);
			var t = clamp01((u - P.sideSeal) / (1 - 2 * P.sideSeal));
			var k = 2 * t - 1;
			// Cross-section: a pointed lens near the top, a full oval at the base.
			var shape = Math.pow(Math.max(0, 1 - k * k), 1 - 0.5 * fl.q);
			var z = 0.004 + P.depth * fl.f * shape;
			var x = (u - 0.5) * P.width * (1 - 0.07 * fl.f); // a filled pouch pulls in a little at the sides
			var y = (v - 0.5) * P.height;
			return [x, y, side * z];
		}

		function addFace(side) {
			var start = pos.length / 3;
			var i, j;
			for (j = 0; j <= NV; j++) {
				var v = j / NV;
				for (i = 0; i <= NU; i++) {
					// More columns near the side seals, where the surface curves the most.
					var u = 0.5 - 0.5 * Math.cos(Math.PI * i / NU);
					var p = point(u, v, side);
					pos.push(p[0], p[1], p[2]);
					nor.push(0, 0, 0);
					// Front reads the left half of the image; the back reads the right half,
					// mirrored so it isn't back-to-front when you turn the pouch around.
					uv.push(side > 0 ? u * 0.5 : 0.5 + (1 - u) * 0.5, v);
					panel.push(u, v);
				}
			}
			for (j = 0; j < NV; j++) {
				for (i = 0; i < NU; i++) {
					var a = start + j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
					if (side > 0) idx.push(a, b, d, a, d, c);
					else idx.push(a, d, b, a, c, d);
				}
			}
			return start;
		}

		var front = addFace(1);
		var back = addFace(-1);

		// Flat base, joining the bottom edges of the front and back. By default it
		// takes the colour of the label's bottom edge so it blends in; if the label
		// has a "bottom" image, that is shown here instead. For that, each base
		// point remembers where it is on the base: side to side (x) and front to
		// back (z). (Stored as x = -2.5 - x so the shader can tell base points
		// apart from everything else: they are the only ones at -2 or below.)
		var baseStart = pos.length / 3;
		var baseHalfWidth = 0, baseHalfDepth = 0;
		for (var i = 0; i <= NU; i++) {
			for (var s = 0; s < 2; s++) {
				var src = (s === 0 ? front : back) + i;
				var bx = pos[src * 3], bz = pos[src * 3 + 2];
				pos.push(bx, pos[src * 3 + 1], bz);
				nor.push(0, -1, 0);
				uv.push(uv[front * 2 + i * 2], 0.004);
				panel.push(-2.5 - bx, bz);
				baseHalfWidth = Math.max(baseHalfWidth, Math.abs(bx));
				baseHalfDepth = Math.max(baseHalfDepth, Math.abs(bz));
			}
		}
		for (i = 0; i < NU; i++) {
			var f0 = baseStart + i * 2, b0 = f0 + 1, f1 = f0 + 2, b1 = f0 + 3;
			idx.push(f0, b0, b1, f0, b1, f1);
		}

		// Sealed edge. The front and back sheets sit a hair apart (the thickness
		// of the sealed film), so without this you could see straight through the
		// gap between them when the pouch is turned edge-on — it showed up as a
		// thin black line down the side. This closes the gap with a narrow strip
		// running up the left side, across the top and down the right side. The
		// strip takes the colour of the front label's edge at that spot (both of
		// its sides read the same point of the image — reading the front on one
		// side and the back on the other would smear the whole label across it).
		function addEdge(count, vertexAt, nx, ny, flip) {
			var start = pos.length / 3;
			var k, side;
			for (k = 0; k <= count; k++) {
				for (side = 0; side < 2; side++) {
					var at = vertexAt(k);
					var from = (side === 0 ? front : back) + at;
					pos.push(pos[from * 3], pos[from * 3 + 1], pos[from * 3 + 2]);
					nor.push(nx, ny, 0);
					uv.push(uv[(front + at) * 2], uv[(front + at) * 2 + 1]);
					panel.push(-1, -1);
				}
			}
			for (k = 0; k < count; k++) {
				var ef0 = start + k * 2, eb0 = ef0 + 1, ef1 = ef0 + 2, eb1 = ef0 + 3;
				if (flip) idx.push(ef0, eb1, eb0, ef0, ef1, eb1);
				else idx.push(ef0, eb0, eb1, ef0, eb1, ef1);
			}
		}
		var perRow = NU + 1;
		addEdge(NV, function (j) { return j * perRow; }, -1, 0, true);          // left side
		addEdge(NV, function (j) { return j * perRow + NU; }, 1, 0, false);     // right side
		addEdge(NU, function (i) { return NV * perRow + i; }, 0, 1, true);      // top

		// Smooth normals for the two faces (average of the surrounding triangles).
		var faceIndexCount = NU * NV * 6 * 2;
		for (var n = 0; n < faceIndexCount; n += 3) {
			var ia = idx[n] * 3, ib = idx[n + 1] * 3, ic = idx[n + 2] * 3;
			var e1x = pos[ib] - pos[ia], e1y = pos[ib + 1] - pos[ia + 1], e1z = pos[ib + 2] - pos[ia + 2];
			var e2x = pos[ic] - pos[ia], e2y = pos[ic + 1] - pos[ia + 1], e2z = pos[ic + 2] - pos[ia + 2];
			var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
			nor[ia] += nx; nor[ia + 1] += ny; nor[ia + 2] += nz;
			nor[ib] += nx; nor[ib + 1] += ny; nor[ib + 2] += nz;
			nor[ic] += nx; nor[ic + 1] += ny; nor[ic + 2] += nz;
		}
		for (var m = 0; m < baseStart * 3; m += 3) {
			var len = Math.sqrt(nor[m] * nor[m] + nor[m + 1] * nor[m + 1] + nor[m + 2] * nor[m + 2]) || 1;
			nor[m] /= len; nor[m + 1] /= len; nor[m + 2] /= len;
		}

		return {
			positions: new Float32Array(pos),
			normals: new Float32Array(nor),
			uvs: new Float32Array(uv),
			panels: new Float32Array(panel),
			indices: new Uint16Array(idx),
			baseWidth: baseHalfWidth * 2,   // size of the base, for fitting a bottom image onto it
			baseDepth: baseHalfDepth * 2
		};
	}

	// ------------------------------------------------------------------
	// GL resources (re-created if the browser ever drops the WebGL context)
	// ------------------------------------------------------------------
	var program = null, uniforms = {}, indexCount = 0, maxAnisotropy = 0, anisoExt = null;
	var baseWidth = 1, baseDepth = 0.3, maxTextureSize = 2048;

	function compile(type, source) {
		var shader = gl.createShader(type);
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			throw new Error("Pouch shader: " + gl.getShaderInfoLog(shader));
		}
		return shader;
	}

	function setupGL() {
		program = gl.createProgram();
		gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
		gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error("Pouch program: " + gl.getProgramInfoLog(program));
		}
		gl.useProgram(program);

		var mesh = buildPouch(POUCH);
		indexCount = mesh.indices.length;
		baseWidth = mesh.baseWidth;
		baseDepth = mesh.baseDepth;

		function attribute(name, data, size) {
			var location = gl.getAttribLocation(program, name);
			var buffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
			if (location < 0) return;
			gl.enableVertexAttribArray(location);
			gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
		}
		attribute("aPosition", mesh.positions, 3);
		attribute("aNormal", mesh.normals, 3);
		attribute("aUv", mesh.uvs, 2);
		attribute("aPanel", mesh.panels, 2);

		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

		["uProjView", "uModel", "uLabel", "uBottom", "uBottomScale", "uHasBottom", "uCamera", "uTopSeal"].forEach(function (name) {
			uniforms[name] = gl.getUniformLocation(program, name);
		});
		gl.uniform1i(uniforms.uLabel, 0);
		gl.uniform1i(uniforms.uBottom, 1);
		maxTextureSize = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048);
		gl.uniform1f(uniforms.uTopSeal, POUCH.topSeal);

		gl.enable(gl.DEPTH_TEST);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.BACK);
		gl.clearColor(0, 0, 0, 0);

		anisoExt = gl.getExtension("EXT_texture_filter_anisotropic") ||
			gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
		maxAnisotropy = anisoExt ? gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 0;
	}

	// Turn a loaded <img> into a WebGL texture.
	function makeTexture(image) {
		var source = image;
		var width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
		if (!isWebGL2) {
			// Older WebGL can only do smooth scaling on power-of-two images.
			var pot = document.createElement("canvas");
			pot.width = 2048;
			pot.height = 2048;
			pot.getContext("2d").drawImage(image, 0, 0, pot.width, pot.height);
			source = pot;
		} else if (Math.max(width, height) > maxTextureSize) {
			// Very large image (bigger than a graphics card needs or, on phones,
			// can take): shrink it to 2048 px on its longest side, same proportions.
			var k = maxTextureSize / Math.max(width, height);
			var small = document.createElement("canvas");
			small.width = Math.max(1, Math.round(width * k));
			small.height = Math.max(1, Math.round(height * k));
			small.getContext("2d").drawImage(image, 0, 0, small.width, small.height);
			source = small;
		}
		var texture = gl.createTexture();
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
		gl.generateMipmap(gl.TEXTURE_2D);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		if (anisoExt) {
			gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAnisotropy));
		}
		return texture;
	}

	// ------------------------------------------------------------------
	// Small matrix helpers (column-major, like WebGL expects)
	// ------------------------------------------------------------------
	function perspective(fovY, aspect, near, far) {
		var f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
		return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
	}

	// Model matrix: spin around the pouch's upright axis, then tilt towards / away from the viewer.
	function modelMatrix(spin, tilt) {
		var cy = Math.cos(spin), sy = Math.sin(spin), cx = Math.cos(tilt), sx = Math.sin(tilt);
		return [
			cy, sx * sy, -cx * sy, 0,
			0, cx, sx, 0,
			sy, -sx * cy, cx * cy, 0,
			0, 0, 0, 1
		];
	}

	// ------------------------------------------------------------------
	// State
	// ------------------------------------------------------------------
	var labels = [];        // [{ name, image (url), img (HTMLImageElement), texture }]
	var current = -1;       // index of the label currently on the pouch
	var wanted = 0;         // index the pouch is changing to (same as current when idle)

	var spin = 0, tilt = 0; // where the user has turned it to
	var spinVelocity = 0;   // leftover momentum after letting go
	var swayAmount = 0;     // 0 = no idle sway, 1 = full
	var swayClock = 0;
	var lastInteraction = -Infinity;
	var dragging = false, lastX = 0, lastY = 0, activePointer = null;

	var change = null;      // the "switch label" spin: { from, to, tiltFrom, start, swapped, lastCos }

	var cameraDistance = 4;
	var FOV = 28 * Math.PI / 180;
	var inView = false, running = false, lastFrame = 0, contextLost = false;

	function displayedSpin() {
		return spin + swayAmount * SWAY_ANGLE * Math.sin(swayClock * SWAY_SPEED);
	}

	// ------------------------------------------------------------------
	// Size
	// ------------------------------------------------------------------
	function resize() {
		var rect = canvas.getBoundingClientRect();
		var ratio = Math.min(window.devicePixelRatio || 1, 2);
		var width = Math.max(1, Math.round(rect.width * ratio));
		var height = Math.max(1, Math.round(rect.height * ratio));
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		// Pull the camera back just far enough that the pouch fits whichever way it's turned.
		var aspect = width / height;
		var tan = Math.tan(FOV / 2);
		var fitHeight = (POUCH.height / 2 * 1.22) / tan;
		var fitWidth = (POUCH.width / 2 * 1.3) / (tan * aspect);
		cameraDistance = Math.max(fitHeight, fitWidth) + POUCH.depth;
	}

	// ------------------------------------------------------------------
	// Draw one frame
	// ------------------------------------------------------------------
	function draw() {
		if (contextLost || current < 0 || !labels[current] || !labels[current].texture) return;
		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		var projection = perspective(FOV, canvas.width / canvas.height, 0.1, 50);
		// The camera just sits back on the z axis looking at the pouch, so
		// projection * view is the projection with one extra translation.
		var projView = projection.slice();
		projView[12] = projection[8] * -cameraDistance;
		projView[13] = projection[9] * -cameraDistance;
		projView[14] = projection[10] * -cameraDistance + projection[14];
		projView[15] = projection[11] * -cameraDistance;

		gl.uniformMatrix4fv(uniforms.uProjView, false, new Float32Array(projView));
		gl.uniformMatrix4fv(uniforms.uModel, false, new Float32Array(modelMatrix(displayedSpin(), tilt)));
		gl.uniform3f(uniforms.uCamera, 0, 0, cameraDistance);
		var label = labels[current];
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, label.bottomTexture || label.texture);
		if (label.bottomTexture) {
			// Lay the image flat on the base, centred, keeping its proportions and
			// just big enough to cover the whole base (like CSS "background-size: cover").
			var shown = Math.max(baseWidth, label.bottomAspect * baseDepth); // width of the image, in pouch units
			gl.uniform2f(uniforms.uBottomScale, 1 / shown, label.bottomAspect / shown);
			gl.uniform1f(uniforms.uHasBottom, 1);
		} else {
			gl.uniform2f(uniforms.uBottomScale, 1, 1);
			gl.uniform1f(uniforms.uHasBottom, 0);
		}
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, label.texture);
		gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
	}

	// ------------------------------------------------------------------
	// Animation loop — only runs while the pouch is on screen.
	// ------------------------------------------------------------------
	function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

	function frame(now) {
		if (!running) return;
		var dt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
		lastFrame = now;

		if (change) {
			var t = Math.min(1, (now - change.start) / CHANGE_DURATION);
			var e = easeInOut(t);
			spin = change.from + (change.to - change.from) * e;
			tilt = change.tiltFrom * (1 - e);
			// Swap the artwork at the moment the pouch is edge-on, so the change is never seen.
			var c = Math.cos(displayedSpin());
			if (!change.swapped && ((c <= 0) !== (change.lastCos <= 0) || t >= 1)) {
				current = wanted;
				change.swapped = true;
				updateCaption();
			}
			change.lastCos = c;
			if (t >= 1) {
				spin = spin % (Math.PI * 2);
				change = null;
				lastInteraction = now;
			}
		} else if (!dragging && Math.abs(spinVelocity) > 0.0002) {
			spin += spinVelocity;               // coast to a stop after a flick
			spinVelocity *= Math.pow(0.92, dt * 60);
		}

		var idle = !dragging && !change && now - lastInteraction > IDLE_BEFORE_SWAY;
		var swayTarget = idle && !reducedMotion ? 1 : 0;
		swayAmount += (swayTarget - swayAmount) * Math.min(1, dt * (swayTarget ? 1.2 : 8));
		swayClock += dt;

		draw();
		requestAnimationFrame(frame);
	}

	function updateRunning() {
		var shouldRun = inView && !document.hidden && !contextLost && current >= 0;
		if (shouldRun && !running) {
			running = true;
			lastFrame = performance.now();
			requestAnimationFrame(frame);
		} else if (!shouldRun) {
			running = false;
		}
	}

	// ------------------------------------------------------------------
	// Labels
	// ------------------------------------------------------------------
	function updateCaption() {
		var label = labels[current];
		if (nameEl) nameEl.textContent = label && label.name ? label.name : "";
		if (countEl) countEl.textContent = labels.length > 1 ? (current + 1) + " / " + labels.length : "";
	}

	function loadLabel(label, done) {
		if (label.texture) return done(true);
		if (label.failed) return done(false);
		if (label.waiting) { label.waiting.push(done); return; }
		label.waiting = [done];
		var img = new Image();
		function finish(ok) {
			var callbacks = label.waiting; label.waiting = null;
			callbacks.forEach(function (cb) { cb(ok); });
		}
		img.onload = function () {
			label.img = img;
			try { label.texture = makeTexture(img); } catch (e) { label.failed = true; }
			if (label.failed || !label.bottom) return finish(!label.failed);
			// This label has an image for the bottom of the pouch: wait for it too,
			// so the pouch never shows up with a half-finished base. If it can't
			// be loaded the label still works, just with the plain base.
			var bottomImg = new Image();
			bottomImg.onload = function () {
				try {
					label.bottomTexture = makeTexture(bottomImg);
					label.bottomImg = bottomImg;
					label.bottomAspect = (bottomImg.naturalWidth || 1) / (bottomImg.naturalHeight || 1);
				} catch (e) {
					label.bottomTexture = null;
				}
				finish(true);
			};
			bottomImg.onerror = function () {
				console.error("Pouch viewer: could not load " + label.bottom);
				finish(true);
			};
			bottomImg.src = label.bottom;
		};
		img.onerror = function () {
			label.failed = true;
			console.error("Pouch viewer: could not load " + label.image);
			finish(false);
		};
		img.src = label.image;
	}

	// Go to the next (+1) or previous (-1) label.
	function step(direction) {
		if (labels.length < 2 || current < 0) return;
		var target = (wanted + direction + labels.length) % labels.length;
		// Skip over any label whose image failed to load.
		var guard = 0;
		while (labels[target].failed && guard++ < labels.length) {
			target = (target + direction + labels.length) % labels.length;
		}
		if (target === wanted) return;
		wanted = target;
		loadLabel(labels[target], function (ok) {
			if (!ok || wanted !== target) return;
			var now = performance.now();
			lastInteraction = now;
			spinVelocity = 0;
			if (reducedMotion) {
				current = wanted; spin = 0; tilt = 0; updateCaption();
				return;
			}
			// Spin one full turn in the direction of the arrow and land facing the front.
			var from = displayedSpin();
			swayAmount = 0;
			var turn = Math.PI * 2;
			var to = (direction > 0 ? Math.floor(from / turn) + 1 : Math.ceil(from / turn) - 1) * turn;
			if (Math.abs(to - from) < Math.PI) to += direction * turn; // always a proper spin, never a nudge
			change = { from: from, to: to, tiltFrom: tilt, start: now, swapped: false, lastCos: Math.cos(from) };
			spin = from;
		});
	}

	if (prevBtn) prevBtn.addEventListener("click", function () { step(-1); });
	if (nextBtn) nextBtn.addEventListener("click", function () { step(1); });

	// ------------------------------------------------------------------
	// Drag to rotate (mouse, pen or finger). On touch screens a sideways
	// drag turns the pouch and an up/down swipe still scrolls the page
	// (see touch-action in the CSS).
	// ------------------------------------------------------------------
	canvas.addEventListener("pointerdown", function (event) {
		if (event.button !== undefined && event.button !== 0) return;
		if (change) return;
		dragging = true;
		activePointer = event.pointerId;
		lastX = event.clientX;
		lastY = event.clientY;
		// Carry on from exactly what's on screen (including the idle sway).
		spin = displayedSpin();
		swayAmount = 0;
		spinVelocity = 0;
		lastInteraction = performance.now();
		try { canvas.setPointerCapture(event.pointerId); } catch (e) {}
		viewer.classList.add("is-dragging");
		event.preventDefault();
	});

	canvas.addEventListener("pointermove", function (event) {
		if (!dragging || event.pointerId !== activePointer) return;
		var dx = event.clientX - lastX, dy = event.clientY - lastY;
		lastX = event.clientX;
		lastY = event.clientY;
		spin += dx * DRAG_SPEED;
		tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, tilt + dy * DRAG_SPEED * 0.7));
		spinVelocity = dx * DRAG_SPEED;
		lastInteraction = performance.now();
	});

	function endDrag(event) {
		if (!dragging || (event && event.pointerId !== activePointer)) return;
		dragging = false;
		activePointer = null;
		lastInteraction = performance.now();
		viewer.classList.remove("is-dragging");
	}
	canvas.addEventListener("pointerup", endDrag);
	canvas.addEventListener("pointercancel", endDrag);
	canvas.addEventListener("lostpointercapture", endDrag);

	// Keyboard: with the pouch focused, left / right arrows turn it.
	canvas.addEventListener("keydown", function (event) {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		if (change) return;
		event.preventDefault();
		spin = displayedSpin() + (event.key === "ArrowLeft" ? -0.35 : 0.35);
		swayAmount = 0;
		lastInteraction = performance.now();
	});

	// ------------------------------------------------------------------
	// Start up
	// ------------------------------------------------------------------
	canvas.addEventListener("webglcontextlost", function (event) {
		event.preventDefault();
		contextLost = true;
		updateRunning();
	});
	canvas.addEventListener("webglcontextrestored", function () {
		try {
			setupGL();
			labels.forEach(function (label) {
				label.texture = label.img ? makeTexture(label.img) : null;
				label.bottomTexture = label.bottomImg ? makeTexture(label.bottomImg) : null;
			});
			contextLost = false;
			updateRunning();
		} catch (e) {
			viewer.hidden = true;
		}
	});

	try {
		setupGL();
	} catch (e) {
		console.error(e);
		viewer.hidden = true;
		return;
	}

	resize();
	if ("ResizeObserver" in window) {
		new ResizeObserver(resize).observe(canvas);
	} else {
		window.addEventListener("resize", resize);
	}

	if ("IntersectionObserver" in window) {
		new IntersectionObserver(function (entries) {
			inView = entries[0].isIntersecting;
			updateRunning();
		}, { rootMargin: "100px" }).observe(canvas);
	} else {
		inView = true;
	}
	document.addEventListener("visibilitychange", updateRunning);

	fetch(LABELS_URL)
		.then(function (response) { return response.json(); })
		.then(function (data) {
			labels = (Array.isArray(data) ? data : []).map(function (entry) {
				// Each entry is { "name": "...", "image": "...", "bottom": "..." (optional) }
				// — or just the image path as text.
				return typeof entry === "string" ? { name: "", image: entry, bottom: "" } : { name: entry.name || "", image: entry.image, bottom: entry.bottom || "" };
			}).filter(function (label) { return !!label.image; });

			if (!labels.length) { viewer.hidden = true; return; }
			if (labels.length < 2) viewer.classList.add("has-single-label");

			loadLabel(labels[0], function (ok) {
				if (!ok) { viewer.hidden = true; return; }
				current = wanted = 0;
				updateCaption();
				viewer.classList.add("is-ready");
				lastInteraction = performance.now() - IDLE_BEFORE_SWAY; // start swaying straight away
				updateRunning();
				draw();
				// Fetch the other designs in the background so the arrows respond instantly.
				labels.slice(1).forEach(function (label) { loadLabel(label, function () {}); });
			});
		})
		.catch(function (error) {
			console.error("Pouch viewer: could not load " + LABELS_URL, error);
			viewer.hidden = true;
		});
})();
