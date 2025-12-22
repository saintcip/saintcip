const popupOverlay = document.getElementById('popup-overlay');
const calendlyOverlay = document.getElementById('calendly-popup');
const scheduleCallButton = document.getElementById('schedule-call-button');

const overlays = [
    { element: popupOverlay, closeSelector: '[data-popup-close]' },
    { element: calendlyOverlay, closeSelector: '[data-calendly-close]' }
];

function setOverlayVisibility(overlay, isVisible) {
    if (!overlay) {
        return;
    }

    overlay.classList.toggle('is-visible', isVisible);
    overlay.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
}

function openOverlay(overlay) {
    setOverlayVisibility(overlay, true);
}

function closeOverlay(overlay) {
    setOverlayVisibility(overlay, false);
}

overlays.forEach(({ element, closeSelector }) => {
    if (!element) {
        return;
    }

    element.setAttribute('aria-hidden', 'true');

    element.querySelectorAll(closeSelector).forEach((trigger) => {
        trigger.addEventListener('click', () => closeOverlay(element));
    });

    element.addEventListener('click', (event) => {
        if (event.target === element) {
            closeOverlay(element);
        }
    });
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
        return;
    }

    overlays.forEach(({ element }) => {
        if (element && element.classList.contains('is-visible')) {
            closeOverlay(element);
        }
    });
});

if (popupOverlay) {
    window.addEventListener('load', () => {
        window.setTimeout(() => openOverlay(popupOverlay), 9000);
    });
}

if (scheduleCallButton && calendlyOverlay) {
    scheduleCallButton.addEventListener('click', () => {
        closeOverlay(popupOverlay);
        openOverlay(calendlyOverlay);
    });
}
