public class MarketAnalysis {
    public static void main(String[] args) {
        // Sample data for market analysis
        String[] products = {"Product A", "Product B", "Product C"};
        double[] sales = {15000.0, 25000.0, 10000.0};

        // Analyze the market data
        analyzeMarket(products, sales);
    }

    public static void analyzeMarket(String[] products, double[] sales) {
        System.out.println("Market Analysis Report:");
        System.out.println("-----------------------");
        for (int i = 0; i < products.length; i++) {
            System.out.printf("%s: n$%.2f%n", products[i], sales[i]);
        }
    }


}
