#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Created on Fri Jun 27 19:29:08 2025

@author: ayarce
"""

import os
import pandas as pd
import matplotlib.pyplot as plt

# Ruta de la carpeta con los CSV
input_folder = "/home/ayarce/Nextcloud/Paper_Canarias_plumas/SPAIN_ddeq/png_HERMES/CSV_2021_TOP/plots"  # ← Cambia esto por tu ruta local
output_folder = os.path.join(input_folder, "plots")
os.makedirs(output_folder, exist_ok=True)

# Filtrar solo archivos que terminan en el patrón deseado
for filename in os.listdir(input_folder):
    if filename.endswith("_timeseries_2km_Ktyear.csv"):
        filepath = os.path.join(input_folder, filename)
        
        # Cargar datos
        df = pd.read_csv(filepath, parse_dates=['time'])
        
        # Nombre para el plot
        site_name = filename.replace("_timeseries_2km_Ktyear.csv", "")
        
        # Crear figura
        plt.figure(figsize=(12, 5))
        plt.plot(df['time'], df['NO2_Ktyear'], label=f"{site_name} NO₂ (kT/year)", color='darkblue')
        plt.xlabel("Time")
        plt.ylabel("NO₂ Emissions (kT/year)")
        plt.title(f"NO₂ Time Series for {site_name} (2 km radius)")
        plt.grid(True)
        plt.tight_layout()
        plt.legend()
        
        # Guardar imagen
        plot_path = os.path.join(output_folder, f"{site_name}_NO2_timeseries.png")
        plt.savefig(plot_path)
        plt.close()

print("✅ All plots saved in:", output_folder)
