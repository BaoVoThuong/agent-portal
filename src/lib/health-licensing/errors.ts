/** Lỗi từ các hàm SQL licensing_* → câu cho người dùng. */
export function licensingDatabaseMessage(message: string): { message: string; status: number } {
  if (message.includes("LICENSING_DUPLICATE_CARRIER")) {
    return { message: "This carrier is already listed for that state and product.", status: 409 };
  }
  if (message.includes("LICENSING_NOT_FOUND")) {
    return { message: "This appointment was removed by someone else. Reload the page.", status: 404 };
  }
  if (message.includes("LICENSING_PRODUCT_NOT_FOUND") || message.includes("LICENSING_OPTION_NOT_FOUND")) {
    return {
      message: "A product or carrier was changed in Table Configuration. Reload the page and try again.",
      status: 409,
    };
  }
  return { message: "Could not save. Try again.", status: 500 };
}
