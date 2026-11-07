"use client";
/** Liga/desliga o visual novo (cookie lido no servidor) e recarrega a tela. */
export function setUi(v: "v2" | null) {
  document.cookie = v ? `nx_ui=${v}; path=/; max-age=31536000; samesite=lax` : "nx_ui=; path=/; max-age=0; samesite=lax";
  location.reload();
}
