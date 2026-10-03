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
