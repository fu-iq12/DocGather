import pandas as pd

df1 = pd.DataFrame({'Name': ['Alice', 'Bob'], 'Age': [25, 30]})
df2 = pd.DataFrame({'Product': ['Apple', 'Banana'], 'Price': [1.2, 0.5]})

with pd.ExcelWriter('test.xlsx', engine='openpyxl') as writer:
    df1.to_excel(writer, sheet_name='People', index=False)
    df2.to_excel(writer, sheet_name='Products', index=False)

try:
    with pd.ExcelWriter('test.xlsb', engine='pyxlsb') as writer:
        df1.to_excel(writer, sheet_name='People', index=False)
        df2.to_excel(writer, sheet_name='Products', index=False)
except Exception as e:
    print(f"Skipping xlsb export in test: {e}")
