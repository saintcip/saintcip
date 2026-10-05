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
// OTHER PRODUCTS: a label with "type": "dropper" in labels.json is shown on a
// dropper bottle (amber glass, black cap) instead of the pouch. Its image is
// ONE strip, 2048 x 910 px, that wraps around the bottle: the middle is the
// front, the two ends meet at the back.
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
		"attribute vec2 aPanel;",   // position on the pouch face (0-1 across, 0-1 bottom to top); x = -1: edge strip; x <= -2: the base;
		                            // x = -10: a plain-coloured part of the dropper bottle (y: 0 plastic / rubber, 1 glass, 2 ribbed cap)
		"attribute vec4 aColor;",   // r, g, b: the colour of a plain-coloured part (or a tint over the label image); a: how shiny it is
		"uniform mat4 uProjView;",
		"uniform mat4 uModel;",
		"varying vec3 vNormal;",
		"varying vec3 vWorld;",
		"varying vec2 vUv;",
		"varying vec2 vPanel;",
		"varying vec4 vColor;",
		"varying vec3 vUp;",        // which way is "up" for the model, as currently turned
		"void main() {",
		"	vec4 world = uModel * vec4(aPosition, 1.0);",
		"	vWorld = world.xyz;",
		"	vNormal = mat3(uModel) * aNormal;",
		"	vUv = aUv;",
		"	vPanel = aPanel;",
		"	vColor = aColor;",
		"	vUp = mat3(uModel) * vec3(0.0, 1.0, 0.0);",
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
		"uniform float uFade;",            // 1 = fully visible; dips to 0 while one product is swapped for another
		"varying vec3 vNormal;",
		"varying vec3 vWorld;",
		"varying vec2 vUv;",
		"varying vec2 vPanel;",
		"varying vec4 vColor;",
		"varying vec3 vUp;",
		"",
		// A tall, soft studio light seen as a reflection: brightest where the
		// reflected view points at the light (towards), fading off gently — much
		// more across than up and down, which gives the long soft streak you
		// see down the side of a bottle.
		"float softbox(vec3 R, vec3 towards, float narrow, float tall) {",
		"	vec3 d = R - towards;",
		"	return exp(-(d.x * d.x * narrow + d.y * d.y * tall)) * smoothstep(-0.1, 0.3, R.z);",
		"}",
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
		// Plain-coloured parts of the dropper bottle: glass, cap, rubber bulb.
		"	float isFlat = step(vPanel.x, -9.0);",
		"	float isGlass = isFlat * step(0.5, vPanel.y) * step(vPanel.y, 1.5);",
		"	float isRibbed = isFlat * step(1.5, vPanel.y);",
		"	if (isRibbed > 0.5) {",
		// Grip ribs running up the side of the cap (vUv.x goes once round the cap).
		"		vec3 around = cross(normalize(vUp), N);",
		"		if (length(around) > 0.01) N = normalize(N + normalize(around) * 0.42 * sin(vUv.x * 6.2831853 * 64.0));",
		"	}",
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
		"	float isBase = step(vPanel.x, -1.5) * (1.0 - isFlat);",
		"	vec2 bottomUv = vec2(0.5 + (-2.5 - vPanel.x) * uBottomScale.x, 0.5 + vPanel.y * uBottomScale.y);",
		"	vec4 bottomTexel = texture2D(uBottom, bottomUv);",
		"	vec3 labelTexel = texture2D(uLabel, vUv).rgb;",
		"	vec3 base = pow(mix(labelTexel, bottomTexel.rgb, isBase * uHasBottom * bottomTexel.a), vec3(2.2));",
		"	base = mix(base * vColor.rgb, pow(vColor.rgb, vec3(2.2)), isFlat);",
		"	float gloss = vColor.a;",
		"	vec3 color = base * 0.34;",                                                             // ambient
		"	color += lightIt(base, N, V, normalize(vec3(0.45, 0.65, 1.0)), 0.78, 1.0 * gloss);",    // key light, front right
		"	color += lightIt(base, N, V, normalize(vec3(-0.9, 0.15, 0.55)), 0.28, 0.5 * gloss);",   // fill, left
		"	color += lightIt(base, N, V, normalize(vec3(0.0, 0.6, -1.0)), 0.45, 0.6 * gloss);",     // back light
		// The lights above never reach the underside, so the base gets its own
		// soft light from below — otherwise its colour / pattern would look dull.
		"	color += lightIt(base, N, V, normalize(vec3(0.25, -1.0, 0.45)), 0.50 * isBase, 0.35);",
		// Soft edge glow so the silhouette stays readable on the black page.
		"	float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);",
		"	color += vec3(rim) * 0.05;",
		// The dropper bottle's glass, cap and rubber bulb get their own, softer
		// lighting: two big studio lights (a main one front-right, a faint one
		// on the left) instead of the pouch's small bright highlights.
		"	if (isFlat > 0.5) {",
		"		float facing = max(dot(N, V), 0.0);",
		"		vec3 R = reflect(-V, N);",
		"		float mainLight = softbox(R, normalize(vec3(0.72, 0.22, 0.66)), 7.0, 0.8);",
		"		float sideLight = softbox(R, normalize(vec3(-0.86, 0.12, 0.50)), 26.0, 0.8);",
		"		if (isGlass > 0.5) {",
		"			float h = vUv.y * 100.0;",                          // millimetres up from the bottom of the bottle
		"			vec3 deep = pow(vColor.rgb, vec3(2.2)) * 0.26;",    // the glass where no light gets through
		"			vec3 warm = pow(vColor.rgb, vec3(2.2)) * 3.0;",     // the same amber with light glowing through it
		// Light comes in from the right and glows out through the far (left) side of the glass.
		"			float through = pow(max(dot(N, normalize(vec3(-0.80, 0.0, 0.60))), 0.0), 1.6);",
		"			float thin = 0.25 + 0.75 * facing;",
		"			vec3 g = deep + warm * (0.05 + 0.20 * through) * thin;",
		// (The glass is one even colour from top to bottom: no liquid line and no
		// lighter band at the base — both were removed on request.)
		"			g *= mix(0.28, 1.0, smoothstep(0.0, 0.55, facing));",                         // darker towards the edges, where you look through more glass
		"			g *= 1.0 - 0.5 * smoothstep(69.5, 73.5, h);",                                 // shadow under the cap
		"			color = g + vec3(1.0, 0.94, 0.86) * (mainLight * 0.14 + sideLight * 0.05);",
		"		} else {",
		// Black plastic cap / rubber bulb: soft, wrapped shading and a gentle sheen.
		"			float wrap = 0.5 + 0.5 * dot(N, normalize(vec3(0.45, 0.65, 1.0)));",
		"			color = base * (0.35 + 1.25 * wrap * wrap) + vec3(1.0) * gloss * (mainLight * 0.085 + sideLight * 0.03);",
		"		}",
		"	}",
		"	gl_FragColor = vec4(pow(color, vec3(1.0 / 2.2)) * uFade, uFade);",
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
			colors: new Float32Array(pos.length / 3 * 4).fill(1),   // no tint, normal film shine
			indices: new Uint16Array(idx),
			baseWidth: baseHalfWidth * 2,   // size of the base, for fitting a bottom image onto it
			baseDepth: baseHalfDepth * 2
		};
	}

	// ------------------------------------------------------------------
	// The dropper bottle model — used for labels with "type": "dropper".
	// A 30 ml amber glass bottle with a black ribbed cap and rubber bulb,
	// and a paper label wrapped around its body. Every part is a "lathe"
	// shape: an outline (radius, height) spun around the bottle's axis.
	// Measurements are in millimetres, scaled to fit the same space as the
	// pouch. Returns the same kind of arrays as buildPouch.
	// ------------------------------------------------------------------
	var DROPPER = {
		height: 1.47,                    // overall height on screen, in the same units as the pouch (which is 1.5)
		glass: [0.42, 0.175, 0.032],     // amber (the shader works out the dark and the glowing shades from this). Lower = darker glass.
		cap: [0.115, 0.115, 0.12],       // black plastic
		bulb: [0.135, 0.135, 0.14],      // black rubber
		labelFrom: 12, labelTo: 56,      // where the label sits on the bottle, mm from the bottom
		labelWrap: 0.94                  // how far round the bottle the label goes (1 = all the way)
	};

	function buildDropper(D) {
		var AROUND = 96;                 // how many steps round the bottle
		var TOTAL = 112;                 // the real thing is about 112 mm tall with its dropper
		var mm = D.height / TOTAL;
		var pos = [], nor = [], uv = [], panel = [], col = [], idx = [];

		// Spin an outline — a list of [radius, height] points in mm, bottom to
		// top — around the axis. kind: 0 plastic / rubber, 1 glass, 2 ribbed.
		function lathe(outline, color, gloss, kind, options) {
			options = options || {};
			var from = options.from === undefined ? -Math.PI : options.from;
			var to = options.to === undefined ? Math.PI : options.to;
			var start = pos.length / 3, rows = outline.length, i, j;
			for (j = 0; j < rows; j++) {
				// The direction the outline is heading at this point gives the way the surface faces.
				var before = outline[Math.max(0, j - 1)], after = outline[Math.min(rows - 1, j + 1)];
				var dr = after[0] - before[0], dy = after[1] - before[1], length = Math.sqrt(dr * dr + dy * dy) || 1;
				var outward = dy / length, upward = -dr / length;
				for (i = 0; i <= AROUND; i++) {
					var part = i / AROUND, angle = from + (to - from) * part;   // angle 0 = facing the viewer
					var sin = Math.sin(angle), cos = Math.cos(angle);
					pos.push(outline[j][0] * mm * sin, (outline[j][1] - TOTAL / 2) * mm, outline[j][0] * mm * cos);
					nor.push(outward * sin, upward, outward * cos);
					if (options.label) {
						// The paper label: reads the label image, left to right as it wraps round.
						uv.push(part, (outline[j][1] - D.labelFrom) / (D.labelTo - D.labelFrom));
						panel.push(-1, -1);
					} else {
						uv.push(part, outline[j][1] / 100);   // once round, and the height in mm / 100 (the shader uses both)
						panel.push(-10, kind);
					}
					col.push(color[0], color[1], color[2], gloss);
				}
			}
			for (j = 0; j < rows - 1; j++) {
				for (i = 0; i < AROUND; i++) {
					var a = start + j * (AROUND + 1) + i, b = a + 1, c = a + AROUND + 1, d = c + 1;
					idx.push(a, b, d, a, d, c);
				}
			}
		}

		// Points along a curve; at(0..1) gives each one.
		function curve(steps, at) {
			var points = [];
			for (var k = 0; k <= steps; k++) points.push(at(k / steps));
			return points;
		}

		// A smooth line through a few hand-placed points (Catmull-Rom).
		function smooth(points, steps) {
			var out = [];
			for (var k = 0; k < points.length - 1; k++) {
				var p0 = points[Math.max(0, k - 1)], p1 = points[k], p2 = points[k + 1], p3 = points[Math.min(points.length - 1, k + 2)];
				for (var n = 0; n < steps; n++) {
					var t = n / steps, t2 = t * t, t3 = t2 * t;
					out.push([
						0.5 * (2 * p1[0] + (p2[0] - p0[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (3 * p1[0] - p0[0] - 3 * p2[0] + p3[0]) * t3),
						0.5 * (2 * p1[1] + (p2[1] - p0[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (3 * p1[1] - p0[1] - 3 * p2[1] + p3[1]) * t3)
					]);
				}
			}
			out.push(points[points.length - 1]);
			return out;
		}

		// --- Glass bottle (a 30 ml "Boston round"): slightly domed-in bottom,
		// rounded heel, straight body, rounded shoulder, then the ring of glass
		// under the cap.
		var bottle = [[0, 1.4], [6, 1.3], [11, 0.6], [13, 0]]
			.concat(curve(10, function (t) { var a = -Math.PI / 2 + t * Math.PI / 2; return [13 + 3.5 * Math.cos(a), 3.5 + 3.5 * Math.sin(a)]; }).slice(1))
			.concat([[16.5, 6], [16.5, 30], [16.5, 57], [16.5, 60]])
			.concat(curve(16, function (t) { var a = t * Math.PI / 2; return [10.1 + 6.4 * Math.cos(a), 60 + 10.4 * Math.sin(a)]; }).slice(1));
		lathe(bottle, D.glass, 1, 1);
		lathe(smooth([[10.1, 70.4], [10.75, 70.9], [11.0, 71.7], [10.75, 72.5], [9.9, 72.9], [9.6, 73.6]], 5), D.glass, 1, 1);

		// --- Black cap: underside, ribbed skirt, smooth rounded top edge, flat top.
		lathe([[9.6, 73.3], [11.7, 73.3]], D.cap, 1, 0);
		lathe([[11.7, 73.3], [11.7, 85.4]], D.cap, 1, 2);
		lathe([[11.7, 85.4]].concat(curve(8, function (t) { var a = t * Math.PI / 2; return [8.9 + 2.8 * Math.cos(a), 85.8 + 2.9 * Math.sin(a)]; })).concat([[7.4, 88.7]]), D.cap, 1, 0);

		// --- Rubber bulb: a small flange where it sits in the cap, then the teat.
		lathe([[7.4, 88.7], [7.7, 88.9], [7.7, 89.7], [7.3, 90.0]], D.bulb, 0.45, 0);
		lathe(smooth([[7.3, 90.0], [6.5, 90.6], [6.35, 92.5], [6.6, 96], [6.85, 100], [6.85, 104.5], [6.4, 107.8], [5.1, 110.3], [2.9, 111.6], [0, 112]], 6), D.bulb, 0.45, 0);

		// --- Paper label, a hair proud of the glass. Slightly toned down and
		// matt, so it reads as paper next to the glass.
		lathe([[16.72, D.labelFrom], [16.72, D.labelTo]], [0.93, 0.93, 0.93], 0.12, 0,
			{ label: true, from: -Math.PI * D.labelWrap, to: Math.PI * D.labelWrap });

		return {
			positions: new Float32Array(pos),
			normals: new Float32Array(nor),
			uvs: new Float32Array(uv),
			panels: new Float32Array(panel),
			colors: new Float32Array(col),
			indices: new Uint16Array(idx)
		};
	}

	// ------------------------------------------------------------------
	// GL resources (re-created if the browser ever drops the WebGL context)
	// ------------------------------------------------------------------
	var program = null, uniforms = {}, maxAnisotropy = 0, anisoExt = null;
	var models = {}, boundModel = null;   // "pouch" and "dropper", ready to draw
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

		// Send a model's arrays to the graphics card once; useModel() below
		// switches between them when drawing.
		function upload(mesh) {
			function buffer(target, data) {
				var b = gl.createBuffer();
				gl.bindBuffer(target, b);
				gl.bufferData(target, data, gl.STATIC_DRAW);
				return b;
			}
			return {
				attributes: [
					["aPosition", buffer(gl.ARRAY_BUFFER, mesh.positions), 3],
					["aNormal", buffer(gl.ARRAY_BUFFER, mesh.normals), 3],
					["aUv", buffer(gl.ARRAY_BUFFER, mesh.uvs), 2],
					["aPanel", buffer(gl.ARRAY_BUFFER, mesh.panels), 2],
					["aColor", buffer(gl.ARRAY_BUFFER, mesh.colors), 4]
				].map(function (a) { return { location: gl.getAttribLocation(program, a[0]), buffer: a[1], size: a[2] }; }),
				indices: buffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indices),
				count: mesh.indices.length
			};
		}
		var pouchMesh = buildPouch(POUCH);
		baseWidth = pouchMesh.baseWidth;
		baseDepth = pouchMesh.baseDepth;
		models = { pouch: upload(pouchMesh), dropper: upload(buildDropper(DROPPER)) };
		boundModel = null;

		["uProjView", "uModel", "uLabel", "uBottom", "uBottomScale", "uHasBottom", "uCamera", "uTopSeal", "uFade"].forEach(function (name) {
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

	// Point the shader at one model's arrays (pouch or dropper bottle).
	function useModel(model) {
		if (boundModel === model) return;
		model.attributes.forEach(function (a) {
			if (a.location < 0) return;
			gl.bindBuffer(gl.ARRAY_BUFFER, a.buffer);
			gl.enableVertexAttribArray(a.location);
			gl.vertexAttribPointer(a.location, a.size, gl.FLOAT, false, 0, 0);
		});
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, model.indices);
		boundModel = model;
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

	var change = null;      // the "switch label" spin: { from, to, tiltFrom, start, swapped, lastCos, newProduct }
	var fade = 1;           // 1 = fully visible; dips to 0 mid-spin when the product itself changes (pouch <-> bottle)

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

		var projection = perspective(FOV, canvas.width / canvas.height, 1, 20);
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
		gl.uniform1f(uniforms.uFade, fade);
		var model = models[label.type] || models.pouch;
		useModel(model);
		gl.drawElements(gl.TRIANGLES, model.count, gl.UNSIGNED_SHORT, 0);
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
			var c = Math.cos(displayedSpin());
			var swapNow;
			if (change.newProduct) {
				// Pouch <-> bottle: the shapes are too different to swap unnoticed, so
				// the old one fades out as it spins up and the new one fades in.
				var k = Math.min(1, Math.abs(t - 0.5) / 0.3);
				fade = k * k * (3 - 2 * k);
				swapNow = t >= 0.5;
			} else {
				// Same product, new artwork: swap at the moment the pouch is edge-on, so the change is never seen.
				swapNow = (c <= 0) !== (change.lastCos <= 0);
			}
			if (!change.swapped && (swapNow || t >= 1)) {
				current = wanted;
				change.swapped = true;
				updateCaption();
			}
			change.lastCos = c;
			if (t >= 1) {
				spin = spin % (Math.PI * 2);
				change = null;
				fade = 1;
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
				current = wanted; spin = 0; tilt = 0; fade = 1; change = null; updateCaption();
				return;
			}
			// Spin one full turn in the direction of the arrow and land facing the front.
			var from = displayedSpin();
			swayAmount = 0;
			var turn = Math.PI * 2;
			var to = (direction > 0 ? Math.floor(from / turn) + 1 : Math.ceil(from / turn) - 1) * turn;
			if (Math.abs(to - from) < Math.PI) to += direction * turn; // always a proper spin, never a nudge
			change = {
				from: from, to: to, tiltFrom: tilt, start: now, swapped: false, lastCos: Math.cos(from),
				newProduct: labels[target].type !== labels[current].type
			};
			fade = 1;
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
				// Each entry is { "name": "...", "image": "...", "type": "dropper" (optional),
				// "bottom": "..." (optional) } — or just the image path as text.
				if (typeof entry === "string") return { name: "", image: entry, bottom: "", type: "pouch" };
				var type = entry.type === "dropper" ? "dropper" : "pouch";
				return { name: entry.name || "", image: entry.image, type: type, bottom: type === "pouch" ? (entry.bottom || "") : "" };
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
