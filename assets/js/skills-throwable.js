// Photoshop, Illustrator, Blender, JavaScript, TypeScript, and Figma skill
// tiles: drop in with gravity (Matter.js) once scrolled into view, staggered,
// then can be grabbed and thrown around with the mouse. Ported from the same
// "liquidThrowable" mechanism used for the "Services We Offer" section on
// sharpstudiollc.com.

jQuery(function ($) {
        var sceneEl = document.querySelector("[data-skills-throwable-scene]");
        if (!sceneEl || typeof Matter === "undefined") return;

        var throwables = sceneEl.querySelectorAll("[data-skills-throwable-el]");
        if (!throwables.length) return;

        var width = sceneEl.offsetWidth;
        var height = sceneEl.offsetHeight;
        if (!width || !height) return;

        var engine = Matter.Engine.create();
        var runner = Matter.Runner.create();
        var mouse = Matter.Mouse.create(sceneEl);

        // Don't let Matter's mouse hijack page scroll over the scene.
        sceneEl.removeEventListener("mousewheel", mouse.mousewheel);
        sceneEl.addEventListener("mouseleave", mouse.mouseup);

        var mouseConstraint = Matter.MouseConstraint.create(engine, {
                mouse: mouse,
                constraint: { render: { visible: false } }
        });
        engine.gravity.y = 0.8;

        var boundStart = Matter.Bodies.rectangle(-250, height / 2, 500, height * 4, { isStatic: true });
        var boundEnd = Matter.Bodies.rectangle(width + 250, height / 2, 500, height * 4, { isStatic: true });
        var boundBottom = Matter.Bodies.rectangle(0, height + 250, width * 2, 500, { isStatic: true });

        Matter.Composite.add(engine.world, [mouseConstraint, boundStart, boundEnd, boundBottom]);
        Matter.Runner.start(runner, engine);
        runner.enabled = false;

        // The scene itself is pointer-events:none (so empty space never
        // blocks scroll); while something is actively grabbed, open it up
        // so the drag/release still tracks correctly off of a tile.
        Matter.Events.on(mouseConstraint, "mousedown", function () {
                sceneEl.style.pointerEvents = "auto";
        });
        Matter.Events.on(mouseConstraint, "mouseup", function () {
                sceneEl.style.pointerEvents = "";
        });

        // Only simulate while the scene is actually on screen.
        new IntersectionObserver(function (entries) {
                runner.enabled = entries[0].isIntersecting;
        }).observe(sceneEl);

        var bodies = [];
        throwables.forEach(function (el, i) {
                var rot = el.querySelector(".skills-throwable-el-rot");
                var rect = el.getBoundingClientRect();
                var setX = gsap.quickSetter(el, "x", "px");
                var setY = gsap.quickSetter(el, "y", "px");
                var angle = gsap.utils.random(-0.2 * Math.PI, 0.2 * Math.PI);
                var startX = gsap.utils.random(rect.width / 2, Math.max(rect.width / 2, width - rect.width / 2));
                var startY = -rect.height - (i * (rect.height + 14));

                var body = Matter.Bodies.rectangle(startX, startY, rect.width, rect.height, {
                        angle: angle,
                        isStatic: true,
                        restitution: 0.3
                });

                bodies.push(body);
                Matter.Composite.add(engine.world, [body]);

                Matter.Events.on(runner, "tick", function () {
                        if (!runner.enabled) return;
                        rot.style.transform = "translate(-50%, -50%) rotate(" + body.angle.toFixed(2) + "rad)";
                        setY(body.position.y.toFixed(1));
                        setX(body.position.x.toFixed(1));
                });
        });

        // Drop them in, staggered, only once the user has actually
        // scrolled to be on top of this area (most of the scene
        // visible) — not just as soon as it peeks into the viewport.
        var rained = false;
        var startObserver = new IntersectionObserver(function (entries) {
                if (!entries[0].isIntersecting || rained) return;
                rained = true;
                throwables.forEach(function (el) {
                        gsap.to(el, { opacity: 1, duration: 0.35 });
                });
                bodies.forEach(function (body, i) {
                        setTimeout(function () {
                                Matter.Body.setStatic(body, false);
                        }, i * 90);
                });
                startObserver.disconnect();
        }, { threshold: 0.65 });
        startObserver.observe(sceneEl);

        // Add a ceiling once the last tile has fully entered the scene,
        // so a hard throw can't fling one back out above the frame.
        var ceilingAdded = false;
        Matter.Events.on(runner, "tick", function () {
                if (ceilingAdded || !bodies.length) return;
                if (bodies[bodies.length - 1].position.y > height / 2) {
                        Matter.Composite.add(engine.world, [
                                Matter.Bodies.rectangle(width / 2, -20, width, 50, { isStatic: true })
                        ]);
                        ceilingAdded = true;
                }
        });

        // Keep the walls matched to the scene if it's resized.
        window.addEventListener("resize", function () {
                var newWidth = sceneEl.offsetWidth;
                var newHeight = sceneEl.offsetHeight;
                if (!newWidth || !newHeight || (newWidth === width && newHeight === height)) return;
                width = newWidth;
                height = newHeight;
                Matter.Body.setPosition(boundStart, { x: -250, y: height / 2 });
                Matter.Body.setPosition(boundEnd, { x: width + 250, y: height / 2 });
                Matter.Body.setPosition(boundBottom, { x: 0, y: height + 250 });
        });
});
