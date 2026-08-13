// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Small representative SVG set for measuring the on-chain rendering path.
/// These fragments prove composition and storage; final production vectors will be
/// traced from the approved collection layers rather than using this illustration.
library HoodYOORPrototypeSVG {
    function background() internal pure returns (string memory) {
        return string.concat(
            '<defs><radialGradient id="bg" cx="52%" cy="40%" r="76%">',
            '<stop offset="0" stop-color="#e9ff66"/><stop offset=".55" stop-color="#c8ff00"/>',
            '<stop offset="1" stop-color="#9ed900"/></radialGradient>',
            '<pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">',
            '<circle cx="4" cy="4" r="2.4" fill="#17210d" opacity=".12"/></pattern></defs>',
            '<rect width="1024" height="1024" fill="url(#bg)"/>',
            '<rect width="1024" height="1024" fill="url(#dots)"/>',
            '<g fill="none" stroke="#f4ffd0" stroke-width="8" opacity=".44">',
            '<path d="M24 844L126 778l94 25 98-136 97 50 115-177 104 71 132-197 112 54 122-202"/>',
            '<path d="M70 760v92m98-142v111m104-183v123m102-177v105m115-234v136',
            'm105-210v118m110-247v145m112-208v106"/></g>'
        );
    }

    function droid() internal pure returns (string memory) {
        return string.concat(
            '<g stroke="#101514" stroke-width="16" stroke-linejoin="round">',
            '<path fill="#003f42" d="M397 828l30-237h189l25 237z"/>',
            '<path fill="#006f73" d="M416 766l31-174h149l28 174-53 81H468z"/>',
            '<path fill="none" stroke="#4be3df" stroke-width="12" opacity=".65" ',
            'd="M469 618l-18 129m113-130 25 132M482 683h95m-106 55h118"/>',
            '<path fill="#008f93" d="M345 206q20-74 102-91h157q80 18 91 99l-10 391',
            'q-8 124-139 137H471q-126-18-134-143z"/>',
            '<path fill="#00a8ad" d="M357 225q29-74 105-81h124q69 8 91 78l-6 159',
            'q-74-47-153-37-91 9-169 67z" opacity=".75"/>',
            '<path fill="#00656a" d="M346 430q-70 2-77 70 4 66 77 70z"/>',
            '<path fill="#6ff" stroke-width="8" d="M291 474q21-34 51-15l-1 62q-35 8-50-21z"/>',
            '<path fill="none" stroke="#72eeee" stroke-width="13" opacity=".55" ',
            'd="M391 248q16-54 66-70m-69 113-11 206m242-285q34 43 33 96"/>',
            "</g>"
        );
    }

    function clothes() internal pure returns (string memory) {
        return string.concat(
            '<g stroke="#111714" stroke-width="16" stroke-linejoin="round">',
            '<path fill="#c8ff00" d="M203 1024q13-151 123-198l112-43q72 56 161 0l104 42',
            'q111 49 127 199z"/>',
            '<path fill="#b0e900" d="M437 784q76 62 163 0l40 18q-41 95-123 99-82-7-121-98z"/>',
            '<path fill="none" stroke="#8ec800" stroke-width="13" d="M280 906q41 12 85 51',
            'm397-48q-53 17-91 54"/>',
            '<path fill="#121714" stroke="none" d="M674 867l26-31 15 20-13 20 25 11-38 49 8-38-25-7z"/>',
            "</g>"
        );
    }

    function mouth() internal pure returns (string memory) {
        return string.concat(
            '<g stroke="#111" stroke-width="13" stroke-linejoin="round">',
            '<path fill="#8d5358" d="M397 551q112-50 233 0 8 111-117 122-119-13-116-122z"/>',
            '<path fill="#f3c6c8" d="M422 631q89-54 177 2-36 38-87 40-54-3-90-42z"/>',
            '<path fill="#ffd83d" d="M400 550q110-44 226 0l-8 57q-105 33-213 0z"/>',
            '<path fill="none" stroke="#b1810b" stroke-width="7" ',
            'd="M441 538l-5 77m48-88-3 94m48-96 2 95m48-87 3 79"/>',
            "</g>"
        );
    }

    function eyes() internal pure returns (string memory) {
        return string.concat(
            '<g stroke="#101313" stroke-width="15" stroke-linejoin="round">',
            '<path fill="#292d2c" d="M279 359l105-55h275l83 40-18 62-70 8-13-96H520',
            'l-8 106H374l-17-85-70 60z"/>',
            '<path fill="#c8ff00" d="M377 329h126l-9 83H390z"/>',
            '<path fill="#c8ff00" d="M535 329h104l9 74-105 7z"/>',
            '<path fill="none" stroke="#fff" stroke-width="10" d="M462 340l-47 61m196-65-47 63"/>',
            '<circle fill="#111" stroke="none" cx="461" cy="370" r="9"/>',
            '<circle fill="#111" stroke="none" cx="584" cy="370" r="9"/>',
            "</g>"
        );
    }

    function hat() internal pure returns (string memory) {
        return string.concat(
            '<g stroke="#101313" stroke-width="16" stroke-linejoin="round">',
            '<path fill="#242827" d="M335 267q-8-166 112-223 146-36 232 69 37 46 42 115',
            'l-91 9q-137-30-295 30z"/>',
            '<path fill="#151918" d="M334 263q117-54 284-33 120 9 163 61-19 65-132 45',
            '-175-32-315 29z"/>',
            '<path fill="none" d="M448 48q50 74 28 187"/>',
            '<path fill="#c8ff00" stroke="none" d="M571 104l38 29-27 44-7-25-32 49',
            '9-57 25-17-24-8z"/>',
            "</g>"
        );
    }
}
