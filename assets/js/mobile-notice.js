// Mobile-only "designed for desktop" notice (#mobile-desktop-notice).
// Dismissing it is remembered for the rest of the browser session
// (sessionStorage). Loaded right after the notice markup at the top of <body>,
// so an already-dismissed notice is hidden before the page paints.

(function () {
	var notice = document.getElementById("mobile-desktop-notice");
	if (!notice) return;
	var KEY = "desktopNoticeDismissed";
	try {
		if (sessionStorage.getItem(KEY) === "1") {
			notice.classList.add("is-dismissed");
			return;
		}
	} catch (e) {}
	var closeBtn = notice.querySelector("[data-mobile-notice-close]");
	if (!closeBtn) return;
	closeBtn.addEventListener("click", function () {
		notice.classList.add("is-dismissed");
		try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
	});
})();
