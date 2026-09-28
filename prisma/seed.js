import {
  connectDatabase,
  disconnectDatabase,
  prisma,
} from "../lib/prisma.js";

const categories = [
  {
    name: "Мясо и птица",
    slug: "myaso-i-ptitsa",
    sortOrder: 10,
    isFeatured: true,
  },
  {
    name: "Колбасы и деликатесы",
    slug: "kolbasy-i-delikatesy",
    sortOrder: 20,
    isFeatured: true,
  },
  {
    name: "Полуфабрикаты",
    slug: "polufabrikaty",
    sortOrder: 30,
    isFeatured: true,
  },
  {
    name: "Готовая еда",
    slug: "gotovaya-eda",
    sortOrder: 40,
    isFeatured: true,
  },
  {
    name: "Молочные продукты и яйца",
    slug: "molochnye-produkty-i-yaytsa",
    sortOrder: 50,
    isFeatured: true,
  },
  {
    name: "Овощи, фрукты и зелень",
    slug: "ovoshchi-frukty-i-zelen",
    sortOrder: 60,
    isFeatured: true,
  },
  {
    name: "Хлеб и выпечка",
    slug: "khleb-i-vypechka",
    sortOrder: 70,
    isFeatured: true,
  },
  {
    name: "Бакалея",
    slug: "bakaleya",
    sortOrder: 80,
    isFeatured: true,
  },
  {
    name: "Заморозка",
    slug: "zamorozka",
    sortOrder: 90,
    isFeatured: false,
  },
  {
    name: "Рыба и морепродукты",
    slug: "ryba-i-moreprodukty",
    sortOrder: 100,
    isFeatured: false,
  },
  {
    name: "Напитки",
    slug: "napitki",
    sortOrder: 110,
    isFeatured: false,
  },
  {
    name: "Сладости",
    slug: "sladosti",
    sortOrder: 120,
    isFeatured: false,
  },
  {
    name: "Товары для дома",
    slug: "tovary-dlya-doma",
    sortOrder: 130,
    isFeatured: false,
  },
  {
    name: "Товары для детей",
    slug: "tovary-dlya-detey",
    sortOrder: 140,
    isFeatured: false,
  },
  {
    name: "Товары для животных",
    slug: "tovary-dlya-zhivotnykh",
    sortOrder: 150,
    isFeatured: false,
  },
];



const products = [
  {
    categorySlug: "kolbasy-i-delikatesy",
    name: "Колбаса «Таёжная» сырокопчёная",
    slug: "kolbasa-taezhnaya",
    sku: "SD-KOL-001",
    shortDescription:
      "Сырокопчёная колбаса с насыщенным мясным вкусом и ароматом специй.",
    description:
      "«Таёжная» — сырокопчёная колбаса собственного производства с плотной текстурой, выраженным мясным вкусом и лёгким ароматом специй.\n\nПодходит для мясной тарелки, бутербродов, праздничной сервировки и в качестве самостоятельной закуски.",
    unit: "PACKAGE",
    unitLabel: "упаковка, 300 г",
    price: "749.00",
    oldPrice: "999.00",
    step: "1",
    minQuantity: "1",
    stockQuantity: "24",
    isPopular: true,
    isFeatured: true,
    isNew: false,
    sortOrder: 10,
    highlights: [
      "Отборное мясное сырьё",
      "Фирменная рецептура",
      "Контролируемое созревание",
      "Насыщенный натуральный вкус",
      "Удобная вакуумная упаковка",
    ],
    characteristics: [
      { name: "Тип", value: "Сырокопчёная колбаса" },
      { name: "Масса упаковки", value: "300 г" },
      { name: "Упаковка", value: "Вакуумная" },
      { name: "Условия хранения", value: "от 0 °C до +6 °C" },
      { name: "Производитель", value: "Сибирские Деликатесы" },
    ],
    nutrition: [
      { label: "Белки", value: "21 г" },
      { label: "Жиры", value: "35 г" },
      { label: "Углеводы", value: "1 г" },
      { label: "Энергетическая ценность", value: "403 ккал" },
    ],
    images: [
      { url: "/site/images/kol-taezh.webp", alt: "Колбаса Таёжная сырокопчёная", isPrimary: true, sortOrder: 0 },
      { url: "/site/images/taezhnaya.webp", alt: "Колбаса Таёжная — сервировка", isPrimary: false, sortOrder: 10 },
      { url: "/site/images/production/kopt-del.webp", alt: "Сибирские копчёные деликатесы", isPrimary: false, sortOrder: 20 },
      { url: "/site/images/production/avtor-k.webp", alt: "Авторские сибирские колбасы", isPrimary: false, sortOrder: 30 },
    ],
  },
  {
    categorySlug: "molochnye-produkty-i-yaytsa",
    name: "Сыр Алтайский выдержанный",
    slug: "syr-altayskiy",
    sku: "SD-SYR-001",
    shortDescription: "Выдержанный сыр с плотной текстурой и насыщенным сливочным вкусом.",
    description: "Алтайский выдержанный сыр для сырных тарелок, закусок и повседневной кухни.",
    unit: "PACKAGE",
    unitLabel: "упаковка, 200 г",
    price: "679.00",
    oldPrice: "799.00",
    step: "1",
    minQuantity: "1",
    stockQuantity: "18",
    isPopular: false,
    isFeatured: true,
    isNew: false,
    sortOrder: 20,
    characteristics: [{ name: "Масса упаковки", value: "200 г" }],
    images: [{ url: "/site/images/altay-cheese.webp", alt: "Сыр Алтайский выдержанный", isPrimary: true, sortOrder: 0 }],
  },
  {
    categorySlug: "molochnye-produkty-i-yaytsa",
    name: "Молоко отборное 3,4–4,5%",
    slug: "moloko-otbornoe",
    sku: "SD-MILK-001",
    shortDescription: "Отборное молоко с естественной жирностью 3,4–4,5%.",
    description: "Натуральное отборное молоко для завтраков, напитков и домашней кухни.",
    unit: "LITER",
    unitLabel: "1 л",
    price: "129.00",
    oldPrice: null,
    step: "1",
    minQuantity: "1",
    stockQuantity: "36",
    isPopular: false,
    isFeatured: true,
    isNew: true,
    sortOrder: 30,
    images: [{ url: "/site/images/milk.webp", alt: "Молоко отборное", isPrimary: true, sortOrder: 0 }],
  },
  {
    categorySlug: "polufabrikaty",
    name: "Пельмени «Домашние» ручной лепки",
    slug: "pelmeni-domashnie",
    sku: "SD-PEL-001",
    shortDescription: "Домашние пельмени ручной лепки с мясной начинкой.",
    description: "Пельмени собственного производства с тонким тестом и сочной мясной начинкой.",
    unit: "PACKAGE",
    unitLabel: "упаковка, 800 г",
    price: "449.00",
    oldPrice: null,
    step: "1",
    minQuantity: "1",
    stockQuantity: "20",
    isPopular: true,
    isFeatured: true,
    isNew: false,
    sortOrder: 40,
    images: [{ url: "/site/images/prlmeni.webp", alt: "Пельмени Домашние", isPrimary: true, sortOrder: 0 }],
  },
  {
    categorySlug: "ryba-i-moreprodukty",
    name: "Форель слабосолёная филе-кусок",
    slug: "forel-slabosolenaya",
    sku: "SD-FISH-001",
    shortDescription: "Нежная слабосолёная форель в удобной порционной упаковке.",
    description: "Слабосолёное филе форели с деликатным вкусом для закусок и сервировки.",
    unit: "PACKAGE",
    unitLabel: "упаковка, 200 г",
    price: "549.00",
    oldPrice: "699.00",
    step: "1",
    minQuantity: "1",
    stockQuantity: "9",
    isPopular: false,
    isFeatured: true,
    isNew: false,
    sortOrder: 50,
    images: [{ url: "/site/images/forel.webp", alt: "Форель слабосолёная", isPrimary: true, sortOrder: 0 }],
  },
  {
    categorySlug: "kolbasy-i-delikatesy",
    name: "Колбаса «Таёжная» премиум",
    slug: "kolbasa-taezhnaya-premium",
    sku: "SD-KOL-002",
    shortDescription: "Премиальная версия фирменной мясной колбасы.",
    description: "Авторская колбаса собственного производства с выраженным мясным вкусом.",
    unit: "PACKAGE",
    unitLabel: "упаковка, 400 г",
    price: "459.00",
    oldPrice: null,
    step: "1",
    minQuantity: "1",
    stockQuantity: "16",
    isPopular: false,
    isFeatured: false,
    isNew: false,
    sortOrder: 60,
    images: [{ url: "/site/images/taezhnaya.webp", alt: "Колбаса Таёжная премиум", isPrimary: true, sortOrder: 0 }],
  },
  {
    categorySlug: "khleb-i-vypechka",
    name: "Хлеб деревенский на закваске",
    slug: "khleb-derevenskiy",
    sku: "SD-BREAD-001",
    shortDescription: "Деревенский хлеб на закваске с хрустящей корочкой.",
    description: "Хлеб собственного производства на закваске для завтраков и семейного стола.",
    unit: "PIECE",
    unitLabel: "500 г",
    price: "129.00",
    oldPrice: null,
    step: "1",
    minQuantity: "1",
    stockQuantity: "12",
    isPopular: false,
    isFeatured: false,
    isNew: false,
    sortOrder: 70,
    images: [{ url: "/site/images/production/bakery.webp", alt: "Хлеб деревенский на закваске", isPrimary: true, sortOrder: 0 }],
  },
  {
    categorySlug: "bakaleya",
    name: "Варенье из кедровой шишки",
    slug: "varenye-kedrovaya-shishka",
    sku: "SD-JAM-001",
    shortDescription: "Сибирское варенье из молодой кедровой шишки.",
    description: "Необычный сибирский десерт с насыщенным хвойным ароматом.",
    unit: "PACKAGE",
    unitLabel: "банка, 200 г",
    price: "299.00",
    oldPrice: null,
    step: "1",
    minQuantity: "1",
    stockQuantity: "14",
    isPopular: false,
    isFeatured: false,
    isNew: false,
    sortOrder: 80,
    images: [{ url: "/site/images/sale.webp", alt: "Варенье из кедровой шишки", isPrimary: true, sortOrder: 0 }],
  },
  {
    categorySlug: "kolbasy-i-delikatesy",
    name: "Ветчина «Сибирская» из индейки",
    slug: "vetchina-sibirskaya",
    sku: "SD-HAM-001",
    shortDescription: "Нежная ветчина из индейки собственного производства.",
    description: "Мясная ветчина с мягким вкусом для завтраков, закусок и бутербродов.",
    unit: "PACKAGE",
    unitLabel: "упаковка, 400 г",
    price: "369.00",
    oldPrice: null,
    step: "1",
    minQuantity: "1",
    stockQuantity: "22",
    isPopular: false,
    isFeatured: false,
    isNew: true,
    sortOrder: 90,
    images: [{ url: "/site/images/vetchina.webp", alt: "Ветчина Сибирская из индейки", isPrimary: true, sortOrder: 0 }],
  },
  {
    categorySlug: "myaso-i-ptitsa",
    name: "Мясной деликатес собственного производства",
    slug: "myasnoy-delikates",
    sku: "SD-MEAT-001",
    shortDescription: "Мясной деликатес собственного производства для праздничной сервировки.",
    description: "Отборное мясное сырьё и фирменная рецептура собственного производства.",
    unit: "PACKAGE",
    unitLabel: "упаковка, 450 г",
    price: "899.00",
    oldPrice: "999.00",
    step: "1",
    minQuantity: "1",
    stockQuantity: "11",
    isPopular: false,
    isFeatured: true,
    isNew: false,
    sortOrder: 100,
    images: [{ url: "/site/images/production/meat-pol.webp", alt: "Мясной деликатес", isPrimary: true, sortOrder: 0 }],
  },
  {
    categorySlug: "kolbasy-i-delikatesy",
    name: "Авторские колбасы",
    slug: "kolbasy-avtorskie",
    sku: "SD-KOL-003",
    shortDescription: "Авторские колбасы по фирменным рецептурам.",
    description: "Линейка авторских колбас собственного производства.",
    unit: "PACKAGE",
    unitLabel: "упаковка, 350 г",
    price: "629.00",
    oldPrice: null,
    step: "1",
    minQuantity: "1",
    stockQuantity: "19",
    isPopular: true,
    isFeatured: true,
    isNew: false,
    sortOrder: 110,
    images: [{ url: "/site/images/production/avtor-k.webp", alt: "Авторские колбасы", isPrimary: true, sortOrder: 0 }],
  },
  {
    categorySlug: "kolbasy-i-delikatesy",
    name: "Копчёные деликатесы",
    slug: "kopchenye-delikatesy",
    sku: "SD-KOP-001",
    shortDescription: "Копчёные мясные деликатесы собственного производства.",
    description: "Подборка копчёных деликатесов с насыщенным ароматом и плотной текстурой.",
    unit: "PACKAGE",
    unitLabel: "упаковка, 400 г",
    price: "719.00",
    oldPrice: null,
    step: "1",
    minQuantity: "1",
    stockQuantity: "8",
    isPopular: false,
    isFeatured: false,
    isNew: false,
    sortOrder: 120,
    images: [{ url: "/site/images/production/kopt-del.webp", alt: "Копчёные деликатесы", isPrimary: true, sortOrder: 0 }],
  },
  {
    categorySlug: "gotovaya-eda",
    name: "Кулинария собственного производства",
    slug: "kulinariya",
    sku: "SD-COOK-001",
    shortDescription: "Готовая кулинария собственного производства.",
    description: "Свежая кулинария для быстрого домашнего обеда или ужина.",
    unit: "PACKAGE",
    unitLabel: "упаковка, 500 г",
    price: "399.00",
    oldPrice: null,
    step: "1",
    minQuantity: "1",
    stockQuantity: "10",
    isPopular: false,
    isFeatured: false,
    isNew: true,
    sortOrder: 130,
    images: [{ url: "/site/images/production/kulinar.webp", alt: "Кулинария собственного производства", isPrimary: true, sortOrder: 0 }],
  },
];

async function seedProducts() {
  for (const product of products) {
    const category = await prisma.category.findUnique({
      where: {
        slug: product.categorySlug,
      },
      select: {
        id: true,
      },
    });

    if (!category) {
      throw new Error(`Seed category not found: ${product.categorySlug}`);
    }

    const {
      categorySlug: _categorySlug,
      images,
      stockQuantity,
      ...productData
    } = product;

    const savedProduct = await prisma.product.upsert({
      where: {
        slug: product.slug,
      },
      // Inventory is operational data. Re-running seed must never reset a
      // real stock balance after orders/reservations have started.
      update: {
        ...productData,
        categoryId: category.id,
        isActive: true,
        isAvailable: true,
      },
      create: {
        ...productData,
        stockQuantity,
        categoryId: category.id,
        isActive: true,
        isAvailable: true,
      },
      select: {
        id: true,
        stockQuantity: true,
        reservedQuantity: true,
      },
    });

    if (savedProduct.stockQuantity !== null) {
      const movementCount = await prisma.inventoryMovement.count({
        where: {
          productId: savedProduct.id,
        },
      });

      if (movementCount === 0) {
        await prisma.inventoryMovement.create({
          data: {
            productId: savedProduct.id,
            type: "ADJUSTMENT",
            onHandDelta: savedProduct.stockQuantity,
            reservedDelta: "0.000",
            balanceOnHand: savedProduct.stockQuantity,
            balanceReserved: savedProduct.reservedQuantity,
            reason: "Начальный остаток при создании seed-товара",
          },
        });
      }
    }

    await prisma.productImage.deleteMany({
      where: {
        productId: savedProduct.id,
      },
    });

    if (images.length > 0) {
      await prisma.productImage.createMany({
        data: images.map((image) => ({
          ...image,
          productId: savedProduct.id,
        })),
      });
    }
  }
}

async function seedCategories() {
  for (const category of categories) {
    await prisma.category.upsert({
      where: {
        slug: category.slug,
      },

      update: {
        name: category.name,
        sortOrder: category.sortOrder,
        isFeatured: category.isFeatured,
        isActive: true,
      },

      create: {
        ...category,
        isActive: true,
      },
    });
  }
}

async function main() {
  await connectDatabase();

  await seedCategories();
  await seedProducts();

  console.log(
    `Seed completed successfully: ${categories.length} categories and ${products.length} products synchronized.`,
  );
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
