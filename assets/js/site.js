// ============================================================================
// Bio fade-in
//
// Bio intro (Marcos Cipriano + the line under it, including the subtitle) plus
// the "14+ years..." paragraph relocated above "Some of My Skills": all fade
// up together once the top bio block is scrolled into view, same reveal
// pattern as the rest of the page. Selects .bio-fade-item document-wide (not
// just inside #bio-fade-group) since that paragraph now lives further down the
// page but should still fade in the same way. Fixed text, no typing animation.
// ============================================================================

(function () {
        var group = document.getElementById("bio-fade-group");
        if (!group) return;
        var items = document.querySelectorAll(".bio-fade-item");
        if (!items.length) return;

        items.forEach(function (el, i) {
                el.style.transitionDelay = (i * 220) + "ms";
        });

        function revealAll() {
                items.forEach(function (el) {
                        el.classList.add("is-revealed");
                });
        }

        if ("IntersectionObserver" in window) {
                var observer = new IntersectionObserver(function (entries) {
                        entries.forEach(function (entry) {
                                if (entry.isIntersecting) {
                                        revealAll();
                                        observer.unobserve(entry.target);
                                }
                        });
                }, { threshold: 0.2 });
                observer.observe(group);

                // Safety net: never leave the text stuck invisible.
                setTimeout(revealAll, 4000);
        } else {
                revealAll();
        }
})();


// ============================================================================
// "Scroll down" hint
//
// "Scroll down" button at the bottom of the screen (styles in custom.css).
// Shows once the visitor has been at the top of the page (on the hero,
// #page-header) for 3 seconds without scrolling. Disappears as soon as they
// scroll. If they come back to the top and stay put for 3 seconds, it shows
// again. Clicking it (or Enter/Space) scrolls down to the section right
// below the hero.
//
// NOTE: this page doesn't scroll the window — the theme's "tt-smooth-scroll"
// body class makes #scroll-container the element that actually scrolls. So
// we watch scrolling on both (a "scroll" listener on window alone never
// fires here, which is why the old hint never went away).
// ============================================================================

(function () {
        var hero = document.getElementById("page-header");
        var hint = document.querySelector(".made-with-love.scroll-hint");
        if (!hero || !hint) return;

        var scroller = document.getElementById("scroll-container");
        var IDLE_MS = 3000;   // how long without scrolling before it shows
        var TOP_ZONE = 10;    // px scrolled that still counts as "at the top"
        var timer = null;

        function isAtTop() {
                var win = window.pageYOffset || document.documentElement.scrollTop || 0;
                var inner = scroller ? scroller.scrollTop : 0;
                return (win + inner) <= TOP_ZONE;
        }

        function hide() {
                hint.classList.remove("is-visible");
        }

        // (Re)start the 3s countdown — only while sitting at the top.
        function arm() {
                clearTimeout(timer);
                if (!isAtTop()) return;
                timer = setTimeout(function () {
                        if (isAtTop()) hint.classList.add("is-visible");
                }, IDLE_MS);
        }

        // Capture phase: scroll events don't bubble, so this is how one
        // listener hears both the window and #scroll-container.
        document.addEventListener("scroll", function (event) {
                if (event.target !== document && event.target !== scroller) return;
                hide();
                arm();
        }, { capture: true, passive: true });

        function scrollPastHero() {
                var next = hero.nextElementSibling;
                if (!next) return;
                try {
                        next.scrollIntoView({ behavior: "smooth", block: "start" });
                } catch (e) {
                        next.scrollIntoView(true);
                }
        }

        hint.addEventListener("click", scrollPastHero);
        hint.addEventListener("keydown", function (event) {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                scrollPastHero();
        });

        arm();
})();


// ============================================================================
// Polaroid carousel
//
// The row of polaroids in the About section ([data-polaroid-carousel] in
// index.html, styles in custom.css). Desktop / tablet: three across. Phones:
// one in the middle with half of the next one showing on each side (the
// sides fade to black — that part is CSS).
// It moves on by one every few seconds, loops round forever, pauses while
// the mouse is over it, and can be dragged / swiped. No autoplay if the
// visitor has asked their device for reduced motion. Wrapped in try/catch so
// a problem here can never stop the code further down this file.
//
// It also makes sure every handwritten caption fits on its card: a long
// name (plus its year) that would spill over the edges is written a bit
// smaller, just enough to fit. That is re-checked whenever a font finishes
// loading, because the handwriting font arrives a moment after the page.
// ============================================================================

(function () {
        var el = document.querySelector("[data-polaroid-carousel]");
        if (!el || typeof Swiper === "undefined") return;

        var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        try {
                new Swiper(el, {
                        // Phones: the current polaroid is centred and takes a bit more
                        // than half the width (1 / 1.8), which leaves part of the next
                        // one showing on each side. A lower number = bigger polaroids
                        // and less of the neighbours showing (it was 2).
                        slidesPerView: 1.8,
                        centeredSlides: true,
                        spaceBetween: 0,           // the gap is padding inside each slide, so tilted corners aren't cut off
                        loop: true,
                        loopedSlides: 6,           // spare copies at each end, so the loop never shows a gap
                        speed: 650,
                        grabCursor: false,         // the cursor is set in the CSS
                        autoplay: prefersReducedMotion ? false : {
                                delay: 2800,       // how long each position is held, in ms
                                disableOnInteraction: false,
                                pauseOnMouseEnter: true,
                        },
                        a11y: {
                                enabled: true,
                                prevSlideMessage: "Previous project",
                                nextSlideMessage: "Next project",
                        },
                        breakpoints: {
                                768: { slidesPerView: 3, centeredSlides: false },   // tablets and desktop: three full ones
                        },
                });
        } catch (error) {
                console.error("Polaroid carousel:", error);
        }

        // Shrink any caption that is wider than its card (see the note above).
        // "--fit" is read by the font-size rule in custom.css; 1 = normal size.
        function fitCaptions() {
                var captions = el.querySelectorAll(".polaroid-caption");
                for (var i = 0; i < captions.length; i++) {
                        var caption = captions[i];
                        var text = caption.querySelector(".polaroid-caption-text");
                        if (!text) continue;
                        caption.style.setProperty("--fit", "1");
                        var room = caption.clientWidth * 0.94;      // leave a little air at the sides
                        var needed = text.offsetWidth;
                        if (room > 0 && needed > room) {
                                caption.style.setProperty("--fit", (room / needed).toFixed(3));
                        }
                }
        }

        fitCaptions();
        window.addEventListener("load", fitCaptions);
        if (document.fonts) {
                if (document.fonts.ready) document.fonts.ready.then(fitCaptions);
                if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", fitCaptions);
        }
})();


// ============================================================================
// Testimonials carousel
//
// Testimonials carousel (Swiper). Centered/"peek" layout (fractional
// slidesPerView + centeredSlides, responsive via breakpoints) so neighboring
// slides show partial slivers on both sides — paired with the .testimonials-
// fade-left/-right CSS overlays. No nav arrows and no pagination indicator
// (both removed per request) — swipe/drag + keyboard arrows are the only
// controls. Loops forever: after the last testimonial it carries on to the
// first (loopedSlides must cover every slide, since there are only a few and
// more than one is visible at a time). Pauses on hover/focus, respects
// prefers-reduced-motion (no autoplay if set), a11y announcements via
// Swiper's built-in a11y module.
// ============================================================================

(function () {
        var carouselEl = document.querySelector(".testimonials-carousel");
        if (!carouselEl || typeof Swiper === "undefined") return;

        var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        new Swiper(carouselEl, {
                slidesPerView: 1.15,
                centeredSlides: true,
                spaceBetween: 20,
                loop: true,
                loopedSlides: carouselEl.querySelectorAll(".swiper-slide").length,
                speed: 700,
                grabCursor: true,
                keyboard: { enabled: true },
                a11y: {
                        enabled: true,
                        prevSlideMessage: "Previous testimonial",
                        nextSlideMessage: "Next testimonial",
                },
                autoplay: prefersReducedMotion ? false : {
                        delay: 6000,
                        disableOnInteraction: false,
                        pauseOnMouseEnter: true,
                },
                breakpoints: {
                        640: {
                                slidesPerView: 1.3,
                                spaceBetween: 24,
                        },
                        1024: {
                                slidesPerView: 1.6,
                                spaceBetween: 32,
                        },
                        1400: {
                                slidesPerView: 1.9,
                                spaceBetween: 40,
                        },
                },
        });
})();
