// Tên kênh Realtime của một provider — không phụ thuộc gì của Node, nên cả trình
// duyệt lẫn server import được. Kênh chỉ mang tín hiệu "có thay đổi", không mang
// dữ liệu: trình duyệt tự tải lại qua API đã kiểm quyền.

export function providerRoomTopic(providerId: string): string {
  return `provider-${providerId}`;
}

export function providerReactionTopic(providerId: string): string {
  return `${providerRoomTopic(providerId)}:reactions`;
}
