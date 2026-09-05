import 'package:flutter/material.dart';

/// Temporary module entry point. Task 4 replaces this with MapScreen.
void main() {
  runApp(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      title: '內湖離線災情地圖',
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.teal),
      home: const Scaffold(
        body: Center(child: Text('內湖離線災情地圖')),
      ),
    ),
  );
}
