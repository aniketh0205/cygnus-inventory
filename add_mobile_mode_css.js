const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'styles.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Find the @media (max-width: 768px) block
const mediaRegex = /@media \s*\(max-width:\s*768px\)\s*\{([\s\S]*)\}/;
const match = css.match(mediaRegex);

if (match) {
    let mobileRules = match[1];

    // we need to process all top-level selectors in mobileRules to prepend "body.mobile-mode-active "
    // Using a simple AST/Regex for CSS is hard, but since we know the format (flat blocks), we can do:
    let processedRules = mobileRules.replace(/(^|})\s*([^{]+)\s*\{/g, (match, prefix, selectors) => {
        if (!selectors.trim() || selectors.trim() === '') return match;
        
        // Split by comma
        const prepended = selectors.split(',').map(s => {
            let sel = s.trim();
            if(sel === '') return '';
            return 'body.mobile-mode-active ' + sel;
        }).join(', ');
        
        return prefix + '\n' + prepended + ' {';
    });

    // Also inject some base styles for mobile-mode-active
    const baseMobileHarness = `
/* Mobile Mode Preview Wrapper */
body.mobile-mode-active {
    display: flex;
    justify-content: center;
    align-items: center;
    background: #000;
}
body.mobile-mode-active .app-container {
    width: 375px;
    height: 812px;
    max-height: 95vh;
    border-radius: 40px;
    border: 12px solid #222;
    overflow: hidden;
    position: relative;
    box-shadow: 0 0 50px rgba(0,0,0,0.8);
    background-color: var(--bg-base);
}
body.mobile-mode-active .screen {
    min-height: auto;
    height: 100%;
}
body.mobile-mode-active #dashboard-screen {
    height: 100%;
}
`;

    css += '\n\n' + baseMobileHarness + '\n/* Auto-generated rules for mobile-mode-active */\n' + processedRules + '\n';
    
    fs.writeFileSync(cssPath, css);
    console.log("Successfully added mobile mode styles.");
} else {
    console.log("Could not find @media block.");
}
