// ============================================================================
// Portfolio grid
//
// Init portfolio grid: fetches assets/data/portfolio.json and shows only the
// first 3 projects — the ones that have a finished case study. No
// pagination, no category filter.
// ============================================================================

jQuery(function ($) {

	if (!$("#portfolio-grid").length) return;

	// Fixed count, no "load more": the first 3 entries of portfolio.json, on
	// every screen size (three in a row on wide screens — "ttgr-layout-3" on
	// the grid in index.html). It used to be 4 on desktop; the 4th, Muaxx,
	// was taken out because its case study isn't ready yet. Muaxx is still
	// in portfolio.json: to bring it back, set this to 4 (and the grid class
	// back to "ttgr-layout-2" for two per row).
	var INITIAL_COUNT = 3;

	var portfolioData = [];
	var isotopeReady = false;

	var $itemsWrap = $("#portfolio-items-wrap");
	var $container = $("#portfolio-grid .isotope-items-wrap");

	// ============================================================================
	// Portfolio grid images: smooth fade-up reveal, staggered per item.
	// Wrapped in try/catch + timeout safety net so it can never leave images
	// stuck invisible if anything else on the page errors out.
	// ============================================================================
	function attachReveal($items) {
		try {
			if (!$items.length) return;

			$items.each(function (i) {
				this.style.transitionDelay = Math.min(i * 90, 600) + "ms";
			});

			if ("IntersectionObserver" in window) {
				var revealObserver = new IntersectionObserver(function (entries) {
					entries.forEach(function (entry) {
						if (entry.isIntersecting) {
							entry.target.classList.add("is-revealed");
							revealObserver.unobserve(entry.target);
						}
					});
				}, { threshold: 0.1 });

				$items.each(function () {
					revealObserver.observe(this);
				});

				// Safety net: guarantee images never stay stuck invisible.
				setTimeout(function () {
					$items.addClass("is-revealed");
				}, 4000);
			} else {
				$items.addClass("is-revealed");
			}
		} catch (e) {
			$items.addClass("is-revealed");
		}
	}

	// ============================================================================
	// Build one grid item's markup from a portfolio.json entry.
	// No overlay/hover effects at all: image on top, then (in normal
	// flow, below it) the project name as the title and its tag as a
	// small grey line underneath — the theme's own .pgi-caption /
	// .pgi-categories-wrap pattern, used without "pgi-cap-inside" so
	// it renders under the image instead of on top of it.
	// ============================================================================
	function buildItemHtml(item) {
		var name = item.name ? String(item.name) : "";
		var tag = item.tag ? String(item.tag) : "";
		var date = item.date ? String(item.date) : "";
		var altText = name || "Portfolio project";
		var link = item.link ? String(item.link) : "";
		// Role + short "what we designed" blurb, shown under the
		// title/tag + button row. Both come from portfolio.json
		// ("role" and "description"); either can be left out.
		var esc = function (str) {
			return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		};
		var role = item.role ? esc(item.role) : "";
		var desc = item.description ? esc(item.description) : "";
		var clickableAttrs = link ?
			' data-link="' + link.replace(/"/g, "&quot;") + '" role="button" tabindex="0" aria-label="View the ' + (name || "project") + ' case study (opens Behance)"'
			: ' data-under-construction="true" role="button" tabindex="0" aria-label="' + (name || "This project") + ' case study is under construction"';

		return (
			'<div class="tt-grid-item isotope-item">' +
				'<div class="ttgr-item-inner">' +
					'<div class="portfolio-grid-item"' + clickableAttrs + '>' +
						'<div class="pgi-image-wrap">' +
							'<div class="pgi-image-holder cover-opacity-2">' +
								'<div class="pgi-image-inner anim-zoomin">' +
									'<figure class="pgi-image ttgr-height">' +
										'<img src="' + item.image + '" alt="' + altText + '" loading="lazy">' +
									'</figure>' +
								'</div>' +
							'</div>' +
						'</div>' +
						'<div class="pgi-caption">' +
							'<div class="pgi-caption-inner">' +
								'<div class="pgi-caption-text">' +
									'<div class="pgi-title-row">' +
										'<div class="pgi-title">' + name + '</div>' +
										(date ? '<span class="pgi-date">' + date + '</span>' : '') +
									'</div>' +
									(tag ?
										'<div class="pgi-categories-wrap"><span class="pgi-category">' + tag + '</span></div>'
									: '') +
								'</div>' +
								'<span class="pgi-case-study-btn">Case Study</span>' +
							'</div>' +
							((role || desc) ?
								'<p class="pgi-desc">' +
									(role ? '<span class="pgi-desc-role">Role: ' + role + '</span>' : '') +
									(desc ? '<span class="pgi-desc-text">' + desc + '</span>' : '') +
								'</p>'
							: '') +
						'</div>' +
					'</div>' +
				'</div>' +
			'</div>'
		);
	}

	// ============================================================================
	// Render the first INITIAL_COUNT projects only — no pagination/"load more".
	// ============================================================================
	function renderInitialBatch() {
		var firstItems = portfolioData.slice(0, INITIAL_COUNT);
		if (!firstItems.length) return;

		var $newItems = $($.map(firstItems, buildItemHtml).join(""));
		$itemsWrap.append($newItems);

		attachReveal($newItems.find(".ttgr-item-inner"));

		$container.imagesLoaded(function () {
			$container.isotope({
				itemSelector: ".isotope-item",
				layoutMode: "packery",
				transitionDuration: "0.7s",
				percentPosition: true
			});
			isotopeReady = true;

			setTimeout(function () {
				$container.isotope("layout");
				if (window.ScrollTrigger) { ScrollTrigger.refresh(true); }
			}, 500);
		});
	}

	// ============================================================================
	// Fetch the portfolio data, then render the first (and only) batch.
	// ============================================================================
	fetch("assets/data/portfolio.json")
		.then(function (res) { return res.json(); })
		.then(function (data) {
			portfolioData = Array.isArray(data) ? data : [];
			renderInitialBatch();
		})
		.catch(function (err) {
			console.error("Could not load assets/data/portfolio.json", err);
		});

});


// ============================================================================
// Case-study popups
//
// Portfolio item click → either "you're about to leave" confirmation → Behance
// case study, or (if the project has no case study yet) a simple "under
// construction" notice. Self-contained (doesn't touch modal.js; its overlay
// CSS is in modal.css) so it can't affect the existing "Let's connect" /
// Calendly popups.
// ============================================================================

(function () {
        var grid = document.getElementById("portfolio-grid");
        var overlay = document.getElementById("leaving-popup");
        var confirmBtn = document.getElementById("leaving-popup-confirm");
        var constructionOverlay = document.getElementById("construction-popup");
        if (!grid || !overlay || !confirmBtn || !constructionOverlay) return;

        var pendingLink = null;

        function openOverlay(link) {
                pendingLink = link;
                overlay.classList.add("is-visible");
                overlay.setAttribute("aria-hidden", "false");
        }

        function closeOverlay() {
                overlay.classList.remove("is-visible");
                overlay.setAttribute("aria-hidden", "true");
                pendingLink = null;
        }

        function openConstructionOverlay() {
                constructionOverlay.classList.add("is-visible");
                constructionOverlay.setAttribute("aria-hidden", "false");
        }

        function closeConstructionOverlay() {
                constructionOverlay.classList.remove("is-visible");
                constructionOverlay.setAttribute("aria-hidden", "true");
        }

        // Open the confirmation (or the "under construction" notice)
        // when a project card (or its keyboard focus equivalent) is
        // activated.
        function handleActivate(event) {
                var card = event.target.closest(".portfolio-grid-item[data-link], .portfolio-grid-item[data-under-construction]");
                if (!card) return;
                event.preventDefault();
                if (card.hasAttribute("data-link")) {
                        openOverlay(card.getAttribute("data-link"));
                } else {
                        openConstructionOverlay();
                }
        }

        grid.addEventListener("click", handleActivate);

        grid.addEventListener("keydown", function (event) {
                if (event.key !== "Enter" && event.key !== " ") return;
                handleActivate(event);
        });

        // "Yes, take me there" — open the case study in a new tab.
        confirmBtn.addEventListener("click", function () {
                if (pendingLink) {
                        window.open(pendingLink, "_blank", "noopener");
                }
                closeOverlay();
        });

        // "No, stay here" / close button / backdrop click / Escape.
        overlay.querySelectorAll("[data-leaving-close]").forEach(function (el) {
                el.addEventListener("click", closeOverlay);
        });
        overlay.addEventListener("click", function (event) {
                if (event.target === overlay) closeOverlay();
        });

        // Same close behavior for the "under construction" notice.
        constructionOverlay.querySelectorAll("[data-construction-close]").forEach(function (el) {
                el.addEventListener("click", closeConstructionOverlay);
        });
        constructionOverlay.addEventListener("click", function (event) {
                if (event.target === constructionOverlay) closeConstructionOverlay();
        });

        document.addEventListener("keydown", function (event) {
                if (event.key !== "Escape") return;
                if (overlay.classList.contains("is-visible")) closeOverlay();
                if (constructionOverlay.classList.contains("is-visible")) closeConstructionOverlay();
        });
})();
