String formatUpdateTime(String? value) {
  if (value == null || value.trim().isEmpty) return '無資料';

  final parsed = DateTime.tryParse(value);
  if (parsed == null) return value;

  final display = parsed.isUtc ? parsed.toUtc() : parsed;
  final hour = display.hour.toString().padLeft(2, '0');
  final minute = display.minute.toString().padLeft(2, '0');
  final second = display.second.toString().padLeft(2, '0');
  return '${display.year}-${display.month}-${display.day} '
      '$hour:$minute:$second';
}
