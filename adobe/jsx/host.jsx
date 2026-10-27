/* Soma Agente: intentionally minimal. Loading the per-program bridge from this
   startup script leaves Photoshop's and Premiere's script engine unusable, so the
   panel loads jsx/hosts/<program>.jsx itself by absolute path (ensureHostScript). */
var SomaAgentBoot = true;
